import { useEffect, useState } from 'react'

/** Delays a fast-changing value (typing) so the result list and its announcement update once typing pauses. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export const SEARCH_DEBOUNCE_MS = 150
