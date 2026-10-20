import { ApiError } from '@/lib/api/errors'
import type { ComparisonFetchers } from '@/hooks/useComparison'

/**
 * A session cache in front of the two analysis fetchers, shared by the map and state-comparison pages, so the same
 * location and period is analysed once per visit however many pages show it. Identical in-flight requests are
 * shared. The underlying request is aborted only when every caller waiting on it has aborted. Failures are not
 * cached (they can be retried). Results are kept for the session only and the cache is bounded.
 */

type Kind = keyof ComparisonFetchers
type Result<K extends Kind> = Awaited<ReturnType<ComparisonFetchers[K]>>

interface Entry {
  promise: Promise<unknown>
  controller: AbortController
  waiting: number
  settled: boolean
}

export const ANALYSIS_CACHE_LIMIT = 120

export function createCachedFetchers(base: ComparisonFetchers, limit = ANALYSIS_CACHE_LIMIT): ComparisonFetchers & { clear: () => void; size: () => number } {
  const entries = new Map<string, Entry>()

  function call<K extends Kind>(kind: K, request: Parameters<ComparisonFetchers[K]>[0], signal: AbortSignal): Promise<Result<K>> {
    if (signal.aborted) return Promise.reject(new ApiError('aborted', 'Request cancelled.'))
    const key = [kind, request.latitude, request.longitude, request.startDate, request.endDate, request.baselineStartYear ?? '', request.baselineEndYear ?? ''].join('|')
    let entry = entries.get(key)
    if (entry) {
      entries.delete(key) // re-insert: Map order doubles as least-recently-used order
      entries.set(key, entry)
    } else {
      const controller = new AbortController()
      const created: Entry = { controller, waiting: 0, settled: false, promise: Promise.resolve() }
      created.promise = (base[kind] as (r: typeof request, o: { signal: AbortSignal }) => Promise<unknown>)(request, { signal: controller.signal }).then(
        (value) => {
          created.settled = true
          return value
        },
        (error: unknown) => {
          created.settled = true
          if (entries.get(key) === created) entries.delete(key)
          throw error
        },
      )
      created.promise.catch(() => {}) // each waiter handles the outcome; this only marks the shared promise handled
      entry = created
      entries.set(key, entry)
      while (entries.size > limit) {
        const oldest = entries.keys().next().value as string
        const old = entries.get(oldest)!
        if (!old.settled && old.waiting > 0) break // never evict a request someone is waiting for
        entries.delete(oldest)
      }
    }

    const current = entry
    current.waiting += 1
    return new Promise<Result<K>>((resolve, reject) => {
      const onAbort = () => {
        current.waiting -= 1
        if (!current.settled && current.waiting === 0) {
          current.controller.abort()
          if (entries.get(key) === current) entries.delete(key)
        }
        reject(new ApiError('aborted', 'Request cancelled.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      current.promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          current.waiting -= 1
          resolve(value as Result<K>)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          current.waiting -= 1
          reject(error)
        },
      )
    })
  }

  return {
    heatwave: (request, { signal }) => call('heatwave', request, signal),
    anomaly: (request, { signal }) => call('anomaly', request, signal),
    clear: () => entries.clear(),
    size: () => entries.size,
  }
}
