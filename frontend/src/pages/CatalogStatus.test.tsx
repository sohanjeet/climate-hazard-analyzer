import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SLOW_HINT_DELAY_MS, useSlowHint } from '@/hooks/useSlowHint'
import { useObservationLocations, type GeographyApi } from '@/hooks/useGeography'
import { ApiError } from '@/lib/api/errors'
import { CatalogStatus } from '@/pages/CatalogStatus'
import type { ExplorerState } from '@/pages/useExplorer'
import { makeLocations } from '@/test/geoFixtures'

afterEach(() => vi.useRealTimers())

const explorer = (catalog: ExplorerState['catalog'], retryCatalog = vi.fn()) =>
  ({ catalog, coverage: { status: 'loading' }, retryCatalog, retryCoverage: vi.fn() }) as unknown as ExplorerState

describe('useSlowHint', () => {
  it('turns on only after the delay and resets when the wait ends', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ active }) => useSlowHint(active), { initialProps: { active: true } })
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(SLOW_HINT_DELAY_MS - 1))
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
  })
})

describe('CatalogStatus while the geography request waits', () => {
  it('shows plain loading first, then explains a possible cold start', () => {
    vi.useFakeTimers()
    render(<CatalogStatus ex={explorer({ status: 'loading' })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading observation locations…')
    expect(screen.queryByText(/waking up/)).toBeNull()
    act(() => void vi.advanceTimersByTime(SLOW_HINT_DELAY_MS))
    expect(screen.getByRole('status')).toHaveTextContent(/waking up.*up to a minute/)
  })

  it('explains a timeout and Try again reloads the locations', async () => {
    let calls = 0
    const api = {
      locations: vi.fn(async () => {
        calls += 1
        if (calls === 1) throw new ApiError('timeout', 'The request timed out in the browser before the server answered.')
        return makeLocations()
      }),
      coverage: vi.fn(),
    } as unknown as GeographyApi
    const { result } = renderHook(() => useObservationLocations(api))
    await vi.waitFor(() => expect(result.current[0].status).toBe('error'))

    const retry = vi.fn(() => result.current[1]())
    const { rerender } = render(<CatalogStatus ex={explorer(result.current[0], retry)} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/did not answer within 90 seconds/)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(result.current[0].status).toBe('success'))
    expect(api.locations).toHaveBeenCalledTimes(2)
    rerender(<CatalogStatus ex={explorer(result.current[0], retry)} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
