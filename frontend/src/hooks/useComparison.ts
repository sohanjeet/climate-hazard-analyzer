import { useCallback, useEffect, useReducer, useRef } from 'react'
import { ApiError } from '@/lib/api/errors'
import { fetchHeatwaves, fetchTemperatureAnomalies } from '@/lib/api/client'
import type { AnomalyRequest, HeatwaveAnalysis, HeatwaveRequest, TemperatureAnomalies } from '@/lib/api/types'
import type { CityResult, ComparisonLocation, Part } from '@/lib/comparison'

export interface ComparisonFetchers {
  heatwave: (request: HeatwaveRequest, options: { signal: AbortSignal }) => Promise<HeatwaveAnalysis>
  anomaly: (request: AnomalyRequest, options: { signal: AbortSignal }) => Promise<TemperatureAnomalies>
}

export const DEFAULT_FETCHERS: ComparisonFetchers = { heatwave: fetchHeatwaves, anomaly: fetchTemperatureAnomalies }

/**
 * How many locations are analysed at once. Each location makes two independent backend calls (heatwaves and
 * temperature anomalies), so at most 2 x 2 = 4 requests are in flight. The backend serialises identical
 * ingests and caps simultaneous Open-Meteo requests on its own, so this does not add upstream load.
 */
export const COMPARISON_CONCURRENCY = 2

export interface DateRange {
  startDate: string
  endDate: string
}

export type ComparisonState =
  | { status: 'idle'; cities: CityResult[]; range: null; runId: number }
  | { status: 'running'; cities: CityResult[]; range: DateRange; runId: number }

type PartName = 'heatwave' | 'anomaly'

type Action =
  | { type: 'start'; cities: CityResult[]; range: DateRange; runId: number }
  | { type: 'part'; runId: number; id: string; part: PartName; value: Part<unknown> }
  | { type: 'reset'; runId: number }

const IDLE: ComparisonState = { status: 'idle', cities: [], range: null, runId: 0 }

function reducer(state: ComparisonState, action: Action): ComparisonState {
  switch (action.type) {
    case 'start':
      return { status: 'running', cities: action.cities, range: action.range, runId: action.runId }
    case 'reset':
      return { ...IDLE, runId: action.runId }
    case 'part':
      if (state.status !== 'running' || state.runId !== action.runId) return state
      return {
        ...state,
        cities: state.cities.map((city) => (city.location.id === action.id ? { ...city, [action.part]: action.value } : city)),
      }
  }
}

function toApiError(caught: unknown): ApiError {
  return caught instanceof ApiError ? caught : new ApiError('network', caught instanceof Error ? caught.message : 'Unexpected error.')
}

/**
 * Runs the same analysis for 2-4 locations with bounded parallelism. Every location, and each of its two
 * requests, has its own loading / success / error state, so one failure never hides the others, and a failed
 * part can be retried alone. Starting a new run aborts everything still in flight from the previous one.
 */
export function useComparison(fetchers: ComparisonFetchers = DEFAULT_FETCHERS) {
  const [state, dispatch] = useReducer(reducer, IDLE)
  const stateRef = useRef(state)
  const runRef = useRef(0)
  const controllersRef = useRef(new Set<AbortController>())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const abortAll = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort())
    controllersRef.current.clear()
  }, [])

  useEffect(() => abortAll, [abortAll])

  /** Fetches one part of one location and records the outcome; a superseded or aborted fetch records nothing. */
  const runPart = useCallback(
    async (runId: number, location: ComparisonLocation, range: DateRange, part: PartName, controller: AbortController) => {
      dispatch({ type: 'part', runId, id: location.id, part, value: { status: 'loading' } })
      const request = {
        latitude: location.latitude,
        longitude: location.longitude,
        startDate: range.startDate,
        endDate: range.endDate,
      }
      try {
        const data =
          part === 'heatwave'
            ? await fetchers.heatwave(request, { signal: controller.signal })
            : await fetchers.anomaly(request, { signal: controller.signal })
        if (runRef.current !== runId || controller.signal.aborted) return
        dispatch({ type: 'part', runId, id: location.id, part, value: { status: 'success', data } })
      } catch (caught) {
        if (runRef.current !== runId || controller.signal.aborted) return
        const error = toApiError(caught)
        const value: Part<unknown> = error.kind === 'aborted' ? { status: 'idle' } : { status: 'error', error }
        dispatch({ type: 'part', runId, id: location.id, part, value })
      }
    },
    [fetchers],
  )

  /** Works through `locations` with at most COMPARISON_CONCURRENCY of them in flight. */
  const runCities = useCallback(
    async (runId: number, locations: ComparisonLocation[], range: DateRange, partsFor: (l: ComparisonLocation) => PartName[]) => {
      const queue = [...locations]
      const worker = async () => {
        for (let location = queue.shift(); location; location = queue.shift()) {
          const current = location
          const controller = new AbortController()
          controllersRef.current.add(controller)
          await Promise.all(partsFor(current).map((part) => runPart(runId, current, range, part, controller)))
          controllersRef.current.delete(controller)
        }
      }
      await Promise.all(Array.from({ length: Math.min(COMPARISON_CONCURRENCY, locations.length) }, worker))
    },
    [runPart],
  )

  const run = useCallback(
    (locations: ComparisonLocation[], range: DateRange) => {
      abortAll()
      runRef.current += 1
      const runId = runRef.current
      const cities: CityResult[] = locations.map((location) => ({
        location,
        heatwave: { status: 'loading' },
        anomaly: { status: 'loading' },
      }))
      dispatch({ type: 'start', cities, range, runId })
      return runCities(runId, locations, range, () => ['heatwave', 'anomaly'])
    },
    [abortAll, runCities],
  )

  const failedParts = (city: CityResult): PartName[] =>
    (['heatwave', 'anomaly'] as const).filter((part) => city[part].status === 'error')

  /** Retries only the failed parts of one location. */
  const retry = useCallback(
    (id: string) => {
      const current = stateRef.current
      if (current.status !== 'running') return Promise.resolve()
      const city = current.cities.find((c) => c.location.id === id)
      if (!city || failedParts(city).length === 0) return Promise.resolve()
      return runCities(current.runId, [city.location], current.range, () => failedParts(city))
    },
    [runCities],
  )

  /** Retries every failed part, still two locations at a time. */
  const retryFailed = useCallback(() => {
    const current = stateRef.current
    if (current.status !== 'running') return Promise.resolve()
    const failed = current.cities.filter((city) => failedParts(city).length > 0)
    return runCities(
      current.runId,
      failed.map((city) => city.location),
      current.range,
      (location) => failedParts(failed.find((city) => city.location.id === location.id)!),
    )
  }, [runCities])

  const cancel = useCallback(() => {
    abortAll()
    runRef.current += 1
    dispatch({ type: 'reset', runId: runRef.current })
  }, [abortAll])

  return { state, run, retry, retryFailed, cancel }
}
