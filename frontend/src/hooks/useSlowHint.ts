import { useEffect, useState } from 'react'

/** How long a request may wait before the UI explains that the server could be starting up. */
export const SLOW_HINT_DELAY_MS = 5_000

/** True once `active` has been true for `delayMs` without interruption; resets as soon as it turns false. */
export function useSlowHint(active: boolean, delayMs: number = SLOW_HINT_DELAY_MS): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSlow(true), delayMs)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [active, delayMs])
  return active && slow
}
