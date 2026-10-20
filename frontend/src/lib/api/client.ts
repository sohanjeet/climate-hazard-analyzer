import { ApiError, kindForStatus, parseErrorBody, parseRetryAfter } from './errors'
import { parseCoverage, parseHeatwaveAnalysis, parseLocations, parseTemperatureAnomalies } from './parse'
import type {
  AnomalyRequest,
  CoverageRequest,
  CoverageResponse,
  HeatwaveAnalysis,
  HeatwaveRequest,
  LocationsResponse,
  TemperatureAnomalies,
} from './types'

/** A cold analysis takes ~5-15 s; the backend's own worst case is ~33 s per chunk. Give up well after that. */
export const REQUEST_TIMEOUT_MS = 90_000

const DEFAULT_BASE_URL = 'http://localhost:8000'

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined
  return (configured?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function buildHeatwaveUrl(request: HeatwaveRequest, baseUrl: string = getApiBaseUrl()): string {
  const params = new URLSearchParams({
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    start_date: request.startDate,
    end_date: request.endDate,
  })
  if (request.rollingWindowYears !== undefined) params.set('rolling_window_years', String(request.rollingWindowYears))
  if (request.baselineStartYear !== undefined) params.set('baseline_start_year', String(request.baselineStartYear))
  if (request.baselineEndYear !== undefined) params.set('baseline_end_year', String(request.baselineEndYear))
  return `${baseUrl}/api/heatwaves?${params.toString()}`
}

export function buildAnomalyUrl(request: AnomalyRequest, baseUrl: string = getApiBaseUrl()): string {
  const params = new URLSearchParams({
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    start_date: request.startDate,
    end_date: request.endDate,
  })
  if (request.baselineStartYear !== undefined) params.set('baseline_start_year', String(request.baselineStartYear))
  if (request.baselineEndYear !== undefined) params.set('baseline_end_year', String(request.baselineEndYear))
  return `${baseUrl}/api/temperature-anomalies?${params.toString()}`
}

interface FetchOptions {
  signal?: AbortSignal
  timeoutMs?: number
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export function fetchHeatwaves(request: HeatwaveRequest, options: FetchOptions = {}): Promise<HeatwaveAnalysis> {
  return getJson(buildHeatwaveUrl(request, options.baseUrl), parseHeatwaveAnalysis, options)
}

export function fetchTemperatureAnomalies(
  request: AnomalyRequest,
  options: FetchOptions = {},
): Promise<TemperatureAnomalies> {
  return getJson(buildAnomalyUrl(request, options.baseUrl), parseTemperatureAnomalies, options)
}

/** Geography reads never ingest data and answer in well under a second; a slow one is a problem, not work. */
export const GEOGRAPHY_TIMEOUT_MS = 20_000

export function buildLocationsUrl(filter: { country?: string; region?: string } = {}, baseUrl: string = getApiBaseUrl()): string {
  const params = new URLSearchParams()
  if (filter.country) params.set('country', filter.country)
  if (filter.region) params.set('region', filter.region)
  const query = params.toString()
  return `${baseUrl}/api/geography/locations${query ? `?${query}` : ''}`
}

export function buildCoverageUrl(request: CoverageRequest, baseUrl: string = getApiBaseUrl()): string {
  const params = new URLSearchParams({ start_date: request.startDate, end_date: request.endDate })
  if (request.country) params.set('country', request.country)
  if (request.region) params.set('region', request.region)
  return `${baseUrl}/api/geography/coverage?${params.toString()}`
}

export function fetchLocations(
  filter: { country?: string; region?: string } = {},
  options: FetchOptions = {},
): Promise<LocationsResponse> {
  return getJson(buildLocationsUrl(filter, options.baseUrl), parseLocations, { timeoutMs: GEOGRAPHY_TIMEOUT_MS, ...options })
}

export function fetchCoverage(request: CoverageRequest, options: FetchOptions = {}): Promise<CoverageResponse> {
  return getJson(buildCoverageUrl(request, options.baseUrl), parseCoverage, { timeoutMs: GEOGRAPHY_TIMEOUT_MS, ...options })
}

/** GET `url`, map failures onto ApiError kinds, and validate a 2xx body with `parse`. */
async function getJson<T>(url: string, parse: (body: unknown) => T, options: FetchOptions): Promise<T> {
  const { signal, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = options

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onCallerAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    } catch (error) {
      if (timedOut) throw new ApiError('timeout', 'The request timed out in the browser before the server answered.')
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new ApiError('aborted', 'Request cancelled.')
      }
      throw new ApiError('network', 'Network request failed.')
    }

    const requestId = response.headers.get('X-Request-ID')

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      if (timedOut) throw new ApiError('timeout', 'The request timed out in the browser before the server answered.')
      if (controller.signal.aborted) throw new ApiError('aborted', 'Request cancelled.')
      if (response.ok) {
        throw new ApiError('invalid_response', 'The response body was not valid JSON.', {
          status: response.status,
          requestId,
        })
      }
      // Non-JSON error body (for example an HTML page from a proxy): fall through to the status mapping.
    }

    if (!response.ok) {
      const { message, fieldErrors } = parseErrorBody(body)
      throw new ApiError(kindForStatus(response.status), message ?? `Request failed with status ${response.status}.`, {
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
        fieldErrors,
        requestId,
      })
    }

    try {
      return parse(body)
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(error.kind, error.message, { status: response.status, requestId })
      }
      throw error
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
