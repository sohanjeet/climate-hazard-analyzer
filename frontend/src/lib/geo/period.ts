import type { DateRange } from '@/hooks/useComparison'
import { LIMITS, defaultFormValues, latestArchiveDate } from '@/lib/validation'

/** The explorer pages work in whole calendar years, which are the only years the backend counts as complete. */

export const FIRST_ARCHIVE_YEAR = Number(LIMITS.archiveStart.slice(0, 4))

export function lastCompleteYear(now: Date = new Date()): number {
  const latest = latestArchiveDate(now)
  const year = Number(latest.slice(0, 4))
  return latest >= `${year}-12-31` ? year : year - 1
}

export interface YearRange {
  startYear: number
  endYear: number
}

export function defaultYearRange(now: Date = new Date()): YearRange {
  const defaults = defaultFormValues(now)
  return { startYear: Number(defaults.startDate.slice(0, 4)), endYear: Math.min(Number(defaults.endDate.slice(0, 4)), lastCompleteYear(now)) }
}

export const toDateRange = ({ startYear, endYear }: YearRange): DateRange => ({
  startDate: `${startYear}-01-01`,
  endDate: `${endYear}-12-31`,
})

/** Null when valid; otherwise a message (mirrors the backend's 90-calendar-year cap). */
export function yearRangeProblem({ startYear, endYear }: YearRange, now: Date = new Date()): string | null {
  if (startYear > endYear) return 'The start year must be on or before the end year.'
  if (startYear < FIRST_ARCHIVE_YEAR || endYear > lastCompleteYear(now)) {
    return `Choose years from ${FIRST_ARCHIVE_YEAR} to ${lastCompleteYear(now)}.`
  }
  if (endYear - startYear + 1 > LIMITS.maxAnalysisYears) return `Choose at most ${LIMITS.maxAnalysisYears} years.`
  return null
}
