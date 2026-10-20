import { useCallback, useEffect, useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'chta-theme'
export const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark']

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system' // storage can be blocked (private mode, site-data settings)
  }
}

/**
 * Light / dark / follow-the-OS. The choice is a per-browser convenience kept in localStorage; when storage is
 * unavailable the app simply follows the OS. Applies the `dark` class the design tokens key off.
 */
export function useTheme() {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const dark = preference === 'dark' || (preference === 'system' && systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [])

  return { preference, setPreference, dark }
}
