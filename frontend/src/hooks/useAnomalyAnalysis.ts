import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api/errors'
import { fetchTemperatureAnomalies } from '@/lib/api/client'
import type { AnomalyRequest, TemperatureAnomalies } from '@/lib/api/types'
import type { Part } from '@/lib/comparison'

export type AnomalyFetcher = (request: AnomalyRequest, options: { signal: AbortSignal }) => Promise<TemperatureAnomalies>

/**
 * Loads temperature anomalies for the single-location view next to the heatwave analysis. It is independent of
 * that analysis: a failure shows its own message and Retry, and never hides the heatwave results. Starting a new
 * run aborts the previous one.
 */
export function useAnomalyAnalysis(fetcher: AnomalyFetcher = fetchTemperatureAnomalies) {
  const [part, setPart] = useState<Part<TemperatureAnomalies>>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const requestRef = useRef<AnomalyRequest | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const run = useCallback(
    async (request: AnomalyRequest) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      requestRef.current = request
      setPart({ status: 'loading' })
      try {
        const data = await fetcher(request, { signal: controller.signal })
        if (controllerRef.current === controller) setPart({ status: 'success', data })
      } catch (caught) {
        if (controllerRef.current !== controller) return
        const error = caught instanceof ApiError ? caught : new ApiError('network', caught instanceof Error ? caught.message : 'Unexpected error.')
        setPart(error.kind === 'aborted' ? { status: 'idle' } : { status: 'error', error })
      }
    },
    [fetcher],
  )

  const retry = useCallback(() => {
    if (requestRef.current) void run(requestRef.current)
  }, [run])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setPart({ status: 'idle' })
  }, [])

  return { part, run, retry, cancel }
}
