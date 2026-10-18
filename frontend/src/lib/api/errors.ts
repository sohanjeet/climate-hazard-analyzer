import type { FieldError } from './types'

export type ApiErrorKind =
  | 'validation' // 422
  | 'rate_limited' // 429
  | 'unavailable' // 503
  | 'timeout' // 504 or client-side timeout
  | 'upstream' // 502
  | 'server' // 500 and other 5xx
  | 'network' // fetch rejected: offline, DNS, CORS, refused
  | 'invalid_response' // 2xx but body does not match the schema
  | 'http' // any other non-2xx
  | 'aborted'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  /** Seconds to wait before retrying, from a valid Retry-After header. */
  readonly retryAfterSeconds: number | null
  readonly fieldErrors: FieldError[]
  readonly requestId: string | null

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: {
      status?: number | null
      retryAfterSeconds?: number | null
      fieldErrors?: FieldError[]
      requestId?: string | null
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
    this.fieldErrors = options.fieldErrors ?? []
    this.requestId = options.requestId ?? null
  }
}

/** Longest wait we honour from Retry-After; larger values are clamped so the UI never locks for minutes. */
export const MAX_RETRY_AFTER_SECONDS = 120

/** Parses Retry-After: either delta-seconds or an HTTP-date. Returns whole seconds >= 1, or null. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  let seconds: number
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed)
  } else {
    // An HTTP-date always spells out the weekday and month; Date.parse alone would accept strings like "-4".
    if (!/[A-Za-z]{3}/.test(trimmed)) return null
    const at = Date.parse(trimmed)
    if (Number.isNaN(at)) return null
    seconds = Math.ceil((at - now) / 1000)
  }
  if (!Number.isFinite(seconds)) return null
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Backend error bodies are `{"detail": {"error": "<message>", "errors"?: [{field, message}]}}`
 * (backend/app/errors.py). Falls back to FastAPI's list form and to plain strings so a proxy or
 * framework error still reads well.
 */
export function parseErrorBody(body: unknown): { message: string | null; fieldErrors: FieldError[] } {
  if (!isRecord(body)) return { message: null, fieldErrors: [] }
  const detail = body.detail
  if (typeof detail === 'string') return { message: detail, fieldErrors: [] }
  if (Array.isArray(detail)) {
    const fieldErrors = detail.flatMap((item): FieldError[] => {
      if (!isRecord(item) || typeof item.msg !== 'string') return []
      const loc = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : ''
      return [{ field: loc, message: item.msg }]
    })
    return { message: null, fieldErrors }
  }
  if (!isRecord(detail)) return { message: null, fieldErrors: [] }
  const message = typeof detail.error === 'string' ? detail.error : null
  const fieldErrors = Array.isArray(detail.errors)
    ? detail.errors.flatMap((item): FieldError[] =>
        isRecord(item) && typeof item.field === 'string' && typeof item.message === 'string'
          ? [{ field: item.field, message: item.message }]
          : [],
      )
    : []
  return { message, fieldErrors }
}

export function kindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 422:
      return 'validation'
    case 429:
      return 'rate_limited'
    case 503:
      return 'unavailable'
    case 504:
      return 'timeout'
    case 502:
      return 'upstream'
    default:
      return status >= 500 ? 'server' : 'http'
  }
}

export interface ErrorPresentation {
  title: string
  description: string
  /** True when running the same request again may succeed without changing inputs. */
  retryable: boolean
}

/** User-facing copy. The raw backend message is shown by the UI when it adds information. */
export function describeError(error: ApiError): ErrorPresentation {
  switch (error.kind) {
    case 'validation':
      return {
        title: 'The request was not accepted',
        description: 'Check the highlighted inputs and try again.',
        retryable: false,
      }
    case 'rate_limited':
      return {
        title: 'Too many analyses in a short time',
        description:
          'The service limits how often analyses can run. Your inputs are unchanged. Wait for the timer, then run the analysis again.',
        retryable: true,
      }
    case 'unavailable':
      return {
        title: 'The service is temporarily unavailable',
        description:
          'The database or the weather archive could not be reached just now. This usually clears within seconds.',
        retryable: true,
      }
    case 'timeout':
      return {
        title: 'The analysis took too long',
        description:
          'A first analysis for a new location downloads about 30 years of baseline data, which can be slow. Data already fetched is kept, so trying again is usually faster.',
        retryable: true,
      }
    case 'upstream':
      return {
        title: 'The weather archive returned an error',
        description: 'The historical data provider failed to answer. Try again shortly.',
        retryable: true,
      }
    case 'network':
      return {
        title: 'Could not reach the analysis service',
        description:
          'The request never got a response. Check your connection, that the API address is correct, and that the backend is running.',
        retryable: true,
      }
    case 'invalid_response':
      return {
        title: 'The response was not in the expected format',
        description:
          'The service answered, but the data did not match what this dashboard expects. Nothing is shown, to avoid displaying wrong numbers.',
        retryable: false,
      }
    case 'aborted':
      return { title: 'Analysis cancelled', description: 'The request was cancelled before it finished.', retryable: true }
    case 'server':
      return {
        title: 'The service hit an internal error',
        description: 'Something went wrong on the server. Try again; if it persists, the backend logs will have details.',
        retryable: true,
      }
    default:
      return {
        title: 'The request failed',
        description: 'The service rejected the request.',
        retryable: false,
      }
  }
}
