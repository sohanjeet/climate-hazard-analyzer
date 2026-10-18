import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ApiError } from '@/lib/api/errors'
import { fetchHeatwaves } from '@/lib/api/client'
import type { HeatwaveAnalysis, HeatwaveRequest } from '@/lib/api/types'

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading'; request: HeatwaveRequest; startedAt: number }
  | { status: 'success'; request: HeatwaveRequest; data: HeatwaveAnalysis }
  | { status: 'error'; request: HeatwaveRequest; error: ApiError; retryAt: number | null }

type Fetcher = (request: HeatwaveRequest, options: { signal: AbortSignal }) => Promise<HeatwaveAnalysis>

/**
 * Runs one analysis at a time. Starting a new run aborts the previous one, so a slow earlier response can never
 * overwrite a newer result. A Retry-After header on a failure becomes `retryAt`, a timestamp the UI counts down to.
 */
export function useHeatwaveAnalysis(fetcher: Fetcher = fetchHeatwaves) {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const run = useCallback(
    async (request: HeatwaveRequest) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setState({ status: 'loading', request, startedAt: Date.now() })
      try {
        const data = await fetcher(request, { signal: controller.signal })
        if (controllerRef.current !== controller) return
        setState({ status: 'success', request, data })
      } catch (caught) {
        if (controllerRef.current !== controller) return
        const error =
          caught instanceof ApiError
            ? caught
            : new ApiError('network', caught instanceof Error ? caught.message : 'Unexpected error.')
        if (error.kind === 'aborted') {
          setState({ status: 'idle' })
          return
        }
        setState({
          status: 'error',
          request,
          error,
          retryAt: error.retryAfterSeconds !== null ? Date.now() + error.retryAfterSeconds * 1000 : null,
        })
      }
    },
    [fetcher],
  )

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState({ status: 'idle' })
  }, [])

  return { state, run, cancel }
}

/** Re-renders once a second (or every `intervalMs`) while `active`; the caller reads the clock during render. */
function useTicker(active: boolean, intervalMs: number): void {
  const [, tick] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
}

// The two clocks below read Date.now() while rendering on purpose: they re-render on a timer and the value
// shown is the elapsed wall-clock time, which is exactly what must be fresh on every render.

/** Whole seconds left until `until` (a Date.now() timestamp); 0 when finished or unset. */
export function useCountdown(until: number | null): number {
  // oxlint-disable-next-line react/purity
  const now = Date.now()
  useTicker(until !== null && now < until, 250)
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000))
}

/** Seconds since `since`; null when `since` is null. */
export function useElapsedSeconds(since: number | null): number | null {
  // oxlint-disable-next-line react/purity
  const now = Date.now()
  useTicker(since !== null, 1000)
  return since === null ? null : Math.max(0, Math.floor((now - since) / 1000))
}
