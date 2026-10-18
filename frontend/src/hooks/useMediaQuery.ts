import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    if (!window.matchMedia) return
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/** Mirrors the OS colour scheme onto the `dark` class that the design tokens key off. */
export function useSystemTheme(): void {
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
}
