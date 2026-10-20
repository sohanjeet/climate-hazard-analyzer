import { describe, expect, it, vi } from 'vitest'
import { createCachedFetchers } from '@/lib/analysisCache'
import { ApiError } from '@/lib/api/errors'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'

const REQUEST = { latitude: 26.9124, longitude: 75.7873, startDate: '2010-01-01', endDate: '2025-12-31' }

function deferredBase() {
  const pending: { resolve: () => void; reject: (e: unknown) => void; signal: AbortSignal }[] = []
  const heatwave = vi.fn((_r: unknown, { signal }: { signal: AbortSignal }) =>
    new Promise((resolve, reject) => {
      pending.push({ resolve: () => resolve(makeAnalysis()), reject, signal })
    }),
  )
  const anomaly = vi.fn(async () => makeAnomalies())
  return { base: { heatwave, anomaly } as unknown as ComparisonFetchers, heatwave, anomaly, pending }
}

describe('session analysis cache', () => {
  it('shares an in-flight request and serves later calls from the cache', async () => {
    const { base, heatwave, pending } = deferredBase()
    const cached = createCachedFetchers(base)
    const a = cached.heatwave(REQUEST, { signal: new AbortController().signal })
    const b = cached.heatwave(REQUEST, { signal: new AbortController().signal })
    expect(heatwave).toHaveBeenCalledTimes(1)
    pending[0].resolve()
    await expect(a).resolves.toMatchObject({ analysis_type: 'heatwave' })
    await expect(b).resolves.toMatchObject({ analysis_type: 'heatwave' })
    await cached.heatwave(REQUEST, { signal: new AbortController().signal })
    expect(heatwave).toHaveBeenCalledTimes(1)
    // A different period is a different entry.
    void cached.heatwave({ ...REQUEST, startDate: '2011-01-01' }, { signal: new AbortController().signal })
    expect(heatwave).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    const heatwave = vi.fn().mockRejectedValueOnce(new ApiError('upstream', 'bad')).mockResolvedValueOnce(makeAnalysis())
    const cached = createCachedFetchers({ heatwave, anomaly: vi.fn() } as unknown as ComparisonFetchers)
    await expect(cached.heatwave(REQUEST, { signal: new AbortController().signal })).rejects.toMatchObject({ kind: 'upstream' })
    await expect(cached.heatwave(REQUEST, { signal: new AbortController().signal })).resolves.toBeTruthy()
    expect(heatwave).toHaveBeenCalledTimes(2)
  })

  it('keeps the shared request alive while anyone still waits, and aborts it when nobody does', async () => {
    const { base, pending } = deferredBase()
    const cached = createCachedFetchers(base)
    const first = new AbortController()
    const second = new AbortController()
    const a = cached.heatwave(REQUEST, { signal: first.signal })
    const b = cached.heatwave(REQUEST, { signal: second.signal })
    first.abort()
    await expect(a).rejects.toMatchObject({ kind: 'aborted' })
    expect(pending[0].signal.aborted).toBe(false)
    second.abort()
    await expect(b).rejects.toMatchObject({ kind: 'aborted' })
    expect(pending[0].signal.aborted).toBe(true)
    expect(cached.size()).toBe(0) // an aborted request is not cached
  })

  it('rejects an already-aborted call without starting a request', async () => {
    const { base, heatwave } = deferredBase()
    const controller = new AbortController()
    controller.abort()
    await expect(createCachedFetchers(base).heatwave(REQUEST, { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' })
    expect(heatwave).not.toHaveBeenCalled()
  })

  it('stays bounded, dropping the least recently used results', async () => {
    const anomaly = vi.fn(async () => makeAnomalies())
    const cached = createCachedFetchers({ heatwave: vi.fn(), anomaly } as unknown as ComparisonFetchers, 2)
    const signal = new AbortController().signal
    for (const year of [2001, 2002, 2003]) await cached.anomaly({ ...REQUEST, startDate: `${year}-01-01` }, { signal })
    expect(cached.size()).toBe(2)
    await cached.anomaly({ ...REQUEST, startDate: '2001-01-01' }, { signal }) // evicted, so fetched again
    expect(anomaly).toHaveBeenCalledTimes(4)
  })
})
