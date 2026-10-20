import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCoverage, fetchLocations } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
import type { CoverageRequest, CoverageResponse, LocationCoverage, LocationsResponse } from '@/lib/api/types'
import { loadIndia, loadWorld, type CountryFeature, type RegionFeature } from '@/lib/geo/boundaries'

export type Loadable<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: ApiError }

const toApiError = (caught: unknown) =>
  caught instanceof ApiError ? caught : new ApiError('network', caught instanceof Error ? caught.message : 'Unexpected error.')

export interface GeographyApi {
  locations: (options: { signal: AbortSignal }) => Promise<LocationsResponse>
  coverage: (request: CoverageRequest, options: { signal: AbortSignal }) => Promise<CoverageResponse>
}

// The catalog is static for a deployment: fetch it once per session and share it between pages.
let catalog: Promise<LocationsResponse> | null = null

export const DEFAULT_GEOGRAPHY_API: GeographyApi = {
  locations: () => {
    catalog ??= fetchLocations({}, {})
    catalog.catch(() => {
      catalog = null
    })
    return catalog
  },
  coverage: (request, options) => fetchCoverage(request, options),
}

/**
 * Runs `load` whenever `key` changes (or on retry), aborting the superseded request. The result is stored with
 * the key it belongs to, so a new key reads as "loading" without resetting state inside the effect.
 */
function usePromise<T>(key: string, load: (signal: AbortSignal) => Promise<T>): [Loadable<T>, () => void] {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; value: Loadable<T> } | null>(null)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  const fullKey = `${key}#${attempt}`
  useEffect(() => {
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key: fullKey, value: { status: 'success', data } })
      },
      (caught: unknown) => {
        const error = toApiError(caught)
        if (!controller.signal.aborted && error.kind !== 'aborted') setResult({ key: fullKey, value: { status: 'error', error } })
      },
    )
    return () => controller.abort()
  }, [fullKey])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return [result?.key === fullKey ? result.value : { status: 'loading' }, retry]
}

export function useObservationLocations(api: GeographyApi) {
  return usePromise('locations', (signal) => api.locations({ signal }))
}

/**
 * Stored-data coverage for one scope and period. `version` lets the page refetch after an analysis has stored
 * new data; otherwise one request per (scope, period).
 */
export function useCoverage(api: GeographyApi, request: CoverageRequest | null, version: number) {
  const key = request ? `coverage|${request.startDate}|${request.endDate}|${request.country ?? ''}|${request.region ?? ''}|${version}` : 'coverage|none'
  const [state, retry] = usePromise<Map<string, LocationCoverage> | null>(key, (signal) =>
    request
      ? api.coverage(request, { signal }).then((r) => new Map(r.locations.map((row) => [row.location_id, row])))
      : Promise.resolve(null),
  )
  return [state, retry] as const
}

export function useWorldBoundaries() {
  return usePromise<CountryFeature[]>('world', () => loadWorld())
}

export function useIndiaBoundaries() {
  return usePromise<RegionFeature[]>('india', () => loadIndia())
}
