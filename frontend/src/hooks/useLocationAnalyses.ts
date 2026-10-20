import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api/errors'
import type { ObservationLocation } from '@/lib/api/types'
import { COMPARISON_CONCURRENCY, type ComparisonFetchers, type DateRange } from '@/hooks/useComparison'
import { locationId, type CityResult, type Part } from '@/lib/comparison'

export const analysisKey = (locationIdValue: string, range: DateRange) => `${locationIdValue}|${range.startDate}|${range.endDate}`

export function toComparisonLocation(location: ObservationLocation, slot = 0) {
  return {
    id: locationId(location.latitude, location.longitude),
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    slot,
  }
}

interface Job {
  key: string
  location: ObservationLocation
  range: DateRange
}

/**
 * On-demand analyses of catalog locations for the explorer pages. Nothing runs until `analyze` is called (an
 * explicit user action). Results accumulate across selections, keyed by location and period, at most
 * COMPARISON_CONCURRENCY locations at a time (each makes the two existing API calls).
 */
export function useLocationAnalyses(fetchers: ComparisonFetchers) {
  const [results, setResults] = useState<Record<string, CityResult>>({})
  // Mirrors `results` synchronously so `analyze` can decide what to queue without waiting for a render.
  const resultsRef = useRef<Record<string, CityResult>>({})
  const [completed, setCompleted] = useState(0)
  const queue = useRef<Job[]>([])
  const active = useRef(0)
  const controllers = useRef(new Map<string, AbortController>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const running = controllers.current
    return () => {
      mounted.current = false
      running.forEach((c) => c.abort())
      running.clear()
      queue.current = []
    }
  }, [])

  const setPart = useCallback((key: string, part: 'heatwave' | 'anomaly', value: Part<unknown>) => {
    if (!mounted.current) return
    const current = resultsRef.current[key]
    if (!current) return
    resultsRef.current = { ...resultsRef.current, [key]: { ...current, [part]: value } }
    setResults(resultsRef.current)
  }, [])

  // A named function expression, so the completion handler can call it again.
  const pump = useCallback(function pump() {
    while (active.current < COMPARISON_CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!
      active.current += 1
      const controller = new AbortController()
      controllers.current.set(job.key, controller)
      const request = {
        latitude: job.location.latitude,
        longitude: job.location.longitude,
        startDate: job.range.startDate,
        endDate: job.range.endDate,
      }
      const runPart = async (part: 'heatwave' | 'anomaly') => {
        try {
          const data = part === 'heatwave'
            ? await fetchers.heatwave(request, { signal: controller.signal })
            : await fetchers.anomaly(request, { signal: controller.signal })
          setPart(job.key, part, { status: 'success', data })
        } catch (caught) {
          const error = caught instanceof ApiError ? caught : new ApiError('network', 'Unexpected error.')
          setPart(job.key, part, error.kind === 'aborted' ? { status: 'idle' } : { status: 'error', error })
        }
      }
      void Promise.all([runPart('heatwave'), runPart('anomaly')]).finally(() => {
        active.current -= 1
        if (controllers.current.get(job.key) === controller) controllers.current.delete(job.key)
        if (mounted.current) setCompleted((n) => n + 1)
        pump()
      })
    }
  }, [fetchers, setPart])

  /**
   * Queues the locations that have no result for this period, or whose last attempt failed or was cancelled.
   * Successful results are never refetched (and the cached fetchers make a retried half instant).
   */
  const analyze = useCallback(
    (locations: readonly ObservationLocation[], range: DateRange) => {
      const additions: Record<string, CityResult> = {}
      for (const location of locations) {
        const key = analysisKey(location.id, range)
        const existing = resultsRef.current[key]
        const parts = existing ? [existing.heatwave.status, existing.anomaly.status] : []
        const needsRun = !existing || (!parts.includes('loading') && parts.some((st) => st === 'error' || st === 'idle'))
        if (!needsRun || queue.current.some((j) => j.key === key) || controllers.current.has(key)) continue
        additions[key] = { location: toComparisonLocation(location), heatwave: { status: 'loading' }, anomaly: { status: 'loading' } }
        queue.current.push({ key, location, range })
      }
      if (Object.keys(additions).length === 0) return
      resultsRef.current = { ...resultsRef.current, ...additions }
      setResults(resultsRef.current)
      pump()
    },
    [pump],
  )

  const cancelAll = useCallback(() => {
    queue.current = []
    controllers.current.forEach((c) => c.abort())
  }, [])

  return { results, analyze, cancelAll, completed }
}
