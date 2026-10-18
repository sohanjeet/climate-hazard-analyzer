/**
 * Client-side validation that mirrors the backend rules, so most mistakes are caught before a request that
 * can cost several seconds. Sources: routers/analysis.py (Query bounds), HeatwaveService.validate_request and
 * config.py (archive start, archive lag, maximum analysis years).
 */

export const LIMITS = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
  archiveStart: '1940-01-01',
  archiveLagDays: 5,
  maxAnalysisYears: 90,
  rollingWindow: { min: 2, max: 30, default: 5 },
  /** Fewest complete years the backend will fit a trend to (TREND_MIN_OBSERVATIONS). */
  minTrendYears: 3,
} as const

/** Rolling windows offered in the UI; every value is inside the backend range 2 to 30. */
export const ROLLING_WINDOW_OPTIONS = [2, 3, 4, 5, 7, 10, 15, 20, 30] as const

export interface FormValues {
  latitude: string
  longitude: string
  startDate: string
  endDate: string
  rollingWindowYears: string
}

export type FormField = keyof FormValues
export type FormErrors = Partial<Record<FormField, string>>

export interface ValidatedRequest {
  latitude: number
  longitude: number
  startDate: string
  endDate: string
  rollingWindowYears: number
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/

export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Latest date the archive serves: today minus the archive lag (5 days). */
export function latestArchiveDate(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - LIMITS.archiveLagDays)
  return toIsoDate(d)
}

export function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** Calendar years fully inside [start, end]: the only years the backend counts as complete (and can use in trends). */
export function fullCalendarYears(start: string, end: string): number {
  if (!isRealIsoDate(start) || !isRealIsoDate(end) || start > end) return 0
  const startYear = Number(start.slice(0, 4))
  const endYear = Number(end.slice(0, 4))
  const first = start <= `${startYear}-01-01` ? startYear : startYear + 1
  const last = end >= `${endYear}-12-31` ? endYear : endYear - 1
  return Math.max(0, last - first + 1)
}

export function parseCoordinate(raw: string, label: string, min: number, max: number): { value?: number; error?: string } {
  const text = raw.trim()
  if (!text) return { error: `Enter a ${label}.` }
  if (!DECIMAL.test(text)) return { error: `${capitalize(label)} must be a number, for example 28.6139.` }
  const value = Number(text)
  if (!Number.isFinite(value) || value < min || value > max) {
    return { error: `${capitalize(label)} must be between ${min} and ${max}.` }
  }
  return { value }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Shared by the single-location form and the comparison view: the date rules the backend enforces. */
export function validateDateRange(
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): Pick<FormErrors, 'startDate' | 'endDate'> {
  const errors: Pick<FormErrors, 'startDate' | 'endDate'> = {}
  const archiveEnd = latestArchiveDate(now)

  if (!startDate) errors.startDate = 'Choose a start date.'
  else if (!isRealIsoDate(startDate)) errors.startDate = 'Enter a valid start date.'
  else if (startDate < LIMITS.archiveStart) errors.startDate = 'The archive begins on 1 January 1940.'
  else if (startDate > archiveEnd) errors.startDate = `The archive currently ends on ${archiveEnd}.`

  if (!endDate) errors.endDate = 'Choose an end date.'
  else if (!isRealIsoDate(endDate)) errors.endDate = 'Enter a valid end date.'
  else if (endDate < LIMITS.archiveStart) errors.endDate = 'The archive begins on 1 January 1940.'
  else if (endDate > archiveEnd) {
    errors.endDate = `The archive currently ends on ${archiveEnd} (it lags real time by ${LIMITS.archiveLagDays} days).`
  }

  if (!errors.startDate && !errors.endDate) {
    if (startDate > endDate) {
      errors.endDate = 'The end date must be on or after the start date.'
    } else if (Number(endDate.slice(0, 4)) - Number(startDate.slice(0, 4)) + 1 > LIMITS.maxAnalysisYears) {
      errors.endDate = `The range can span at most ${LIMITS.maxAnalysisYears} calendar years.`
    }
  }
  return errors
}

export function validateForm(
  values: FormValues,
  now: Date = new Date(),
): { errors: FormErrors; request: ValidatedRequest | null } {
  const errors: FormErrors = {}
  const { startDate, endDate } = values

  const lat = parseCoordinate(values.latitude, 'latitude', LIMITS.latitude.min, LIMITS.latitude.max)
  if (lat.error) errors.latitude = lat.error
  const lon = parseCoordinate(values.longitude, 'longitude', LIMITS.longitude.min, LIMITS.longitude.max)
  if (lon.error) errors.longitude = lon.error

  Object.assign(errors, validateDateRange(values.startDate, values.endDate, now))

  const windowText = values.rollingWindowYears.trim()
  const windowYears = Number(windowText)
  if (
    !/^\d+$/.test(windowText) ||
    windowYears < LIMITS.rollingWindow.min ||
    windowYears > LIMITS.rollingWindow.max
  ) {
    errors.rollingWindowYears = `Choose a window between ${LIMITS.rollingWindow.min} and ${LIMITS.rollingWindow.max} years.`
  }

  if (Object.keys(errors).length > 0 || lat.value === undefined || lon.value === undefined) {
    return { errors, request: null }
  }
  return {
    errors,
    request: {
      latitude: lat.value,
      longitude: lon.value,
      startDate,
      endDate,
      rollingWindowYears: windowYears,
    },
  }
}

/** Default range: 2010 through the last calendar year that is fully inside the archive. */
export function defaultFormValues(now: Date = new Date()): FormValues {
  const archiveEnd = latestArchiveDate(now)
  const archiveEndYear = Number(archiveEnd.slice(0, 4))
  const lastFullYear = archiveEnd >= `${archiveEndYear}-12-31` ? archiveEndYear : archiveEndYear - 1
  return {
    latitude: '28.6139',
    longitude: '77.2090',
    startDate: '2010-01-01',
    endDate: `${lastFullYear}-12-31`,
    rollingWindowYears: String(LIMITS.rollingWindow.default),
  }
}

/** Maps a backend 422 `errors[].field` (query parameter name) onto a form field. */
export function formFieldForApiField(field: string): FormField | null {
  switch (field) {
    case 'latitude':
      return 'latitude'
    case 'longitude':
      return 'longitude'
    case 'start_date':
      return 'startDate'
    case 'end_date':
      return 'endDate'
    case 'rolling_window_years':
      return 'rollingWindowYears'
    default:
      return null
  }
}

/** Best-guess field for a service-level 422 message that names no field (HeatwaveServiceError). */
export function formFieldForMessage(message: string): FormField | null {
  const text = message.toLowerCase()
  if (text.includes('latitude')) return 'latitude'
  if (text.includes('longitude')) return 'longitude'
  if (text.includes('rolling')) return 'rollingWindowYears'
  if (text.includes('on or before')) return 'endDate'
  if (text.includes('start_date')) return 'startDate'
  if (text.includes('end_date') || text.includes('dates must be') || text.includes('calendar years')) return 'endDate'
  return null
}
