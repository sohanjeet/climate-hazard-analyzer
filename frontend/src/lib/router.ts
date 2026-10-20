import { useEffect, useSyncExternalStore } from 'react'

/**
 * A minimal History API router for the app's seven flat routes. Links keep real hrefs (open in a new tab, copy
 * link) and plain clicks are handled in-page. The host must serve index.html for every path (see vercel.json).
 */

export type RouteId =
  | 'dashboard'
  | 'global'
  | 'india'
  | 'compare-cities'
  | 'compare-states'
  | 'anomalies'
  | 'methodology'
  | 'not-found'

export interface RouteDef {
  id: Exclude<RouteId, 'not-found'>
  path: string
  label: string
  title: string
}

export const ROUTES: readonly RouteDef[] = [
  { id: 'dashboard', path: '/', label: 'Dashboard', title: 'Heatwave dashboard' },
  { id: 'global', path: '/explore/global', label: 'Global Explorer', title: 'Global Climate Explorer' },
  { id: 'india', path: '/explore/india', label: 'India Explorer', title: 'India Climate Explorer' },
  { id: 'compare-cities', path: '/compare/cities', label: 'City Comparison', title: 'City comparison' },
  { id: 'compare-states', path: '/compare/states', label: 'State Comparison', title: 'State comparison' },
  { id: 'anomalies', path: '/anomalies', label: 'Temperature Anomalies', title: 'Temperature anomalies' },
  { id: 'methodology', path: '/methodology', label: 'Methodology', title: 'Methodology' },
]

/** Older or shorter paths that still work. */
const ALIASES: Record<string, string> = { '/compare': '/compare/cities', '/explore': '/explore/global' }

export const pathFor = (id: RouteDef['id']): string => ROUTES.find((r) => r.id === id)!.path

function normalise(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '') || '/'
  return ALIASES[trimmed] ?? trimmed
}

export function routeForPath(pathname: string): RouteId {
  const path = normalise(pathname)
  return ROUTES.find((r) => r.path === path)?.id ?? 'not-found'
}

const NAVIGATE_EVENT = 'chta:navigate'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

const currentPath = () => window.location.pathname

export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  const target = normalise(path)
  if (target !== window.location.pathname) {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', target)
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/** The current route. An alias in the address bar (for example /compare) is rewritten to its canonical path. */
export function useRoute(): RouteId {
  const pathname = useSyncExternalStore(subscribe, currentPath, () => '/')
  useEffect(() => {
    const canonical = normalise(pathname)
    if (canonical !== pathname && routeForPath(canonical) !== 'not-found') navigate(canonical, { replace: true })
  }, [pathname])
  return routeForPath(pathname)
}
