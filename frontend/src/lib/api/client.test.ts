import { describe, expect, it, vi } from 'vitest'
import { makeAnalysis } from '@/test/fixtures'
import { buildHeatwaveUrl, fetchHeatwaves } from './client'
import { ApiError } from './errors'
import type { HeatwaveRequest } from './types'

const request: HeatwaveRequest = {
  latitude: 28.6139,
  longitude: 77.209,
  startDate: '2018-01-01',
  endDate: '2024-12-31',
  rollingWindowYears: 5,
}
const baseUrl = 'http://api.test'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    ...init,
  })
}

async function failure(fetchImpl: typeof fetch, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  try {
    await fetchHeatwaves(request, { baseUrl, fetchImpl, ...options })
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('buildHeatwaveUrl', () => {
  it('uses the backend query parameter names', () => {
    const url = new URL(buildHeatwaveUrl(request, baseUrl))
    expect(url.origin + url.pathname).toBe('http://api.test/api/heatwaves')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '28.6139',
      longitude: '77.209',
      start_date: '2018-01-01',
      end_date: '2024-12-31',
      rolling_window_years: '5',
    })
  })

  it('omits optional parameters that are not set', () => {
    const url = new URL(buildHeatwaveUrl({ ...request, rollingWindowYears: undefined }, baseUrl))
    expect(url.searchParams.has('rolling_window_years')).toBe(false)
    expect(url.searchParams.has('baseline_start_year')).toBe(false)
  })
})

describe('fetchHeatwaves success', () => {
  it('requests JSON and parses the body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(makeAnalysis()))
    const result = await fetchHeatwaves(request, { baseUrl, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.summary.total_events).toBeGreaterThan(0)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/heatwaves?')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  it('rejects a 200 whose body does not match the schema', async () => {
    const error = await failure(async () => jsonResponse({ hello: 'world' }))
    expect(error.kind).toBe('invalid_response')
  })

  it('rejects a 200 that is not JSON', async () => {
    const error = await failure(async () => new Response('<html>', { status: 200 }))
    expect(error.kind).toBe('invalid_response')
  })
})

describe('fetchHeatwaves HTTP errors', () => {
  it('422: carries the message and per-field errors', async () => {
    const error = await failure(async () =>
      jsonResponse(
        { detail: { error: 'Invalid request parameters', errors: [{ field: 'latitude', message: 'Input should be less than or equal to 90' }] } },
        { status: 422 },
      ),
    )
    expect(error.kind).toBe('validation')
    expect(error.status).toBe(422)
    expect(error.message).toBe('Invalid request parameters')
    expect(error.fieldErrors).toEqual([{ field: 'latitude', message: 'Input should be less than or equal to 90' }])
  })

  it('422 from a service rule: message only', async () => {
    const error = await failure(async () =>
      jsonResponse({ detail: { error: 'start_date must be on or before end_date' } }, { status: 422 }),
    )
    expect(error.kind).toBe('validation')
    expect(error.fieldErrors).toEqual([])
    expect(error.message).toBe('start_date must be on or before end_date')
  })

  it('429: reads Retry-After', async () => {
    const error = await failure(async () =>
      jsonResponse({ detail: { error: 'Rate limit exceeded; retry later' } }, { status: 429, headers: { 'Retry-After': '17', 'X-Request-ID': 'abc123' } }),
    )
    expect(error.kind).toBe('rate_limited')
    expect(error.retryAfterSeconds).toBe(17)
    expect(error.requestId).toBe('abc123')
  })

  it('503: reads Retry-After and the message', async () => {
    const error = await failure(async () =>
      jsonResponse({ detail: { error: 'Database temporarily unavailable' } }, { status: 503, headers: { 'Retry-After': '5' } }),
    )
    expect(error.kind).toBe('unavailable')
    expect(error.retryAfterSeconds).toBe(5)
    expect(error.message).toBe('Database temporarily unavailable')
  })

  it('503 without Retry-After leaves it unset', async () => {
    const error = await failure(async () => jsonResponse({ detail: { error: 'Upstream rate limited' } }, { status: 503 }))
    expect(error.retryAfterSeconds).toBeNull()
  })

  it('504: gateway timeout', async () => {
    const error = await failure(async () => jsonResponse({ detail: { error: 'Weather provider timed out' } }, { status: 504 }))
    expect(error.kind).toBe('timeout')
    expect(error.message).toBe('Weather provider timed out')
  })

  it('500 and 502 are distinct kinds', async () => {
    expect((await failure(async () => jsonResponse({ detail: { error: 'Internal server error' } }, { status: 500 }))).kind).toBe('server')
    expect((await failure(async () => jsonResponse({ detail: { error: 'bad gateway' } }, { status: 502 }))).kind).toBe('upstream')
  })

  it('survives a non-JSON error body such as a proxy HTML page', async () => {
    const error = await failure(async () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Retry-After': '3' } }))
    expect(error.kind).toBe('upstream')
    expect(error.message).toBe('Request failed with status 502.')
    expect(error.retryAfterSeconds).toBe(3)
  })
})

describe('fetchHeatwaves transport failures', () => {
  it('maps a rejected fetch (offline, DNS, CORS, refused) to network', async () => {
    const error = await failure(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(error.kind).toBe('network')
    expect(error.status).toBeNull()
  })

  it('times out client-side and says so', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    const error = await failure(hang, { timeoutMs: 20 })
    expect(error.kind).toBe('timeout')
  })

  it('reports a caller abort as aborted, not as a network error', async () => {
    const controller = new AbortController()
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    const pending = failure(hang, { signal: controller.signal, timeoutMs: 5000 })
    controller.abort()
    expect((await pending).kind).toBe('aborted')
  })
})
