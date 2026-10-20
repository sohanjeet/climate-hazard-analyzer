import type { CoverageStatus, LocationCoverage } from '@/lib/api/types'
import { formatNumber } from '@/lib/format'

/** Plain-language meaning of a stored-data status (about storage and speed, never about validity). */
export const COVERAGE_TEXT: Record<CoverageStatus, { label: string; detail: string }> = {
  stored: { label: 'Data stored', detail: 'Baseline and period are in the database, so an analysis takes about a second.' },
  partial: { label: 'Partly stored', detail: 'Some days are stored; an analysis may download the rest (or the archive has gaps).' },
  not_stored: { label: 'Not downloaded yet', detail: 'An analysis downloads about 30 years of data first: 5 to 45 seconds.' },
}

export function coverageDetail(coverage: LocationCoverage | undefined): string | null {
  if (!coverage) return null
  const text = COVERAGE_TEXT[coverage.status]
  return `${text.detail} Stored: ${formatNumber(coverage.baseline_stored_days, 0)} of ${formatNumber(coverage.baseline_expected_days, 0)} baseline days, ${formatNumber(coverage.window_stored_days, 0)} of ${formatNumber(coverage.window_expected_days, 0)} period days.`
}
