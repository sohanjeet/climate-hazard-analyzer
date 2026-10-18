/**
 * Build-time check of VITE_API_BASE_URL, run by vite.config.ts for production builds.
 *
 * The client falls back to http://localhost:8000 when the variable is unset (handy in development), which
 * would silently ship a site that calls the visitor's own machine. Production builds must set it explicitly.
 */

export interface BuildEnvProblem {
  level: 'error' | 'warning'
  message: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/**
 * @param hosted true when building on the hosting platform (Vercel), where a localhost or plain-http API URL
 *   is always a mistake. Locally, a localhost URL is allowed so `npm run build && npm run preview` still works.
 */
export function apiBaseUrlProblem(raw: string | undefined, { hosted }: { hosted: boolean }): BuildEnvProblem | null {
  const value = raw?.trim()
  if (!value) {
    return {
      level: 'error',
      message:
        'VITE_API_BASE_URL is not set. Production builds need the deployed backend URL (e.g. https://<service>.onrender.com); ' +
        'without it the app would call http://localhost:8000.',
    }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { level: 'error', message: 'VITE_API_BASE_URL is not a valid absolute URL (include https://).' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { level: 'error', message: 'VITE_API_BASE_URL must start with http:// or https://.' }
  }

  if (LOCAL_HOSTS.has(url.hostname)) {
    return hosted
      ? { level: 'error', message: 'VITE_API_BASE_URL points at localhost; set it to the deployed backend URL.' }
      : { level: 'warning', message: 'VITE_API_BASE_URL points at localhost; this build only works on this machine.' }
  }
  if (hosted && url.protocol !== 'https:') {
    return { level: 'error', message: 'VITE_API_BASE_URL must use https:// (browsers block http calls from an https page).' }
  }
  return null
}
