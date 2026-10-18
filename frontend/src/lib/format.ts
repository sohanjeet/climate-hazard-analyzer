import type { BaselineInfo, TrendClassification } from './api/types'

const NUMBER_LOCALE = 'en-US'

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatInteger(value: number | null | undefined): string {
  return formatNumber(value, 0)
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const text = formatNumber(Math.abs(value), digits)
  if (Number(text.replace(/,/g, '')) === 0) return text // avoid "+0.00" / "-0.00"
  return `${value < 0 ? '−' : '+'}${text}`
}

export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}°${latitude < 0 ? 'S' : 'N'}`
  const lon = `${Math.abs(longitude).toFixed(3)}°${longitude < 0 ? 'W' : 'E'}`
  return `${lat}, ${lon}`
}

/** ISO date (YYYY-MM-DD...) to "12 Mar 2020", read as UTC so the day never shifts with the viewer's time zone. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatDateTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Collapses a sorted list of ISO dates into ranges: ["2020-01-01","2020-01-02","2020-01-05"] to two ranges. */
export function groupDateRanges(dates: string[]): { start: string; end: string; days: number }[] {
  const sorted = [...dates].sort()
  const ranges: { start: string; end: string; days: number }[] = []
  let previous: number | null = null
  for (const iso of sorted) {
    const [y, m, d] = iso.split('-').map(Number)
    const day = Date.UTC(y, m - 1, d) / 86_400_000
    const last = ranges[ranges.length - 1]
    if (previous !== null && day === previous) continue // duplicate date
    if (last && previous !== null && day - previous === 1) {
      last.end = iso
      last.days += 1
    } else {
      ranges.push({ start: iso, end: iso, days: 1 })
    }
    previous = day
  }
  return ranges
}

export const CLASSIFICATION_LABEL: Record<TrendClassification, string> = {
  increasing: 'Increasing',
  decreasing: 'Decreasing',
  no_significant_trend: 'No significant trend',
  insufficient_data: 'Not enough data',
}

/** Explains a `data_quality.warnings` / `trend.warnings` code in plain language. */
export function describeWarning(
  code: string,
  baseline?: Pick<BaselineInfo, 'start_year' | 'end_year'>,
  context: 'heatwave' | 'anomaly' = 'heatwave',
): string {
  const [name, arg] = code.split(':')
  switch (name) {
    case 'analysis_missing_days':
      if (context === 'anomaly') {
        return `${arg} day${arg === '1' ? '' : 's'} in the period have no valid temperature. They are left out of the averages, never filled in or counted as zero.`
      }
      return `${arg} day${arg === '1' ? '' : 's'} in the analysis window have no valid temperature. Missing days are never filled in and they end a heatwave run, so counts may be underestimates.`
    case 'years_without_anomaly':
      return `${arg} year${arg === '1' ? '' : 's'} in the period get no anomaly because the year is partial or has too many missing days. Their means appear in the table but are not plotted.`
    case 'analysis_overlaps_baseline':
      if (context === 'anomaly') {
        return baseline
          ? `The period overlaps the ${baseline.start_year}–${baseline.end_year} baseline, so those years are compared with an average they helped set. This pulls their anomalies toward zero.`
          : 'The period overlaps the baseline, so those years are compared with an average they helped set.'
      }
      return baseline
        ? `The analysis window overlaps the ${baseline.start_year}–${baseline.end_year} baseline. Those years are compared with a threshold they helped set, which flattens trends.`
        : 'The analysis window overlaps the baseline period. Those years are compared with a threshold they helped set, which flattens trends.'
    case 'baseline_year_low_coverage':
      return context === 'anomaly'
        ? `Baseline year ${arg} has fewer than 90% valid days, so the baseline mean rests on less data from that year.`
        : `Baseline year ${arg} has fewer than 90% valid days, so the threshold rests on less data from that year.`
    case 'incomplete_years_excluded':
      return 'Incomplete years are shown in the charts but excluded from trends and rolling averages.'
    case 'duplicate_date':
      return `The archive returned a duplicate record for ${arg}; the extra record was ignored.`
    case 'invalid_temperature':
      return `The archive returned an invalid temperature for ${arg}; the day is treated as missing.`
    case 'invalid_date':
      return 'The archive returned a record with an invalid date; it was ignored.'
    default: {
      const fewer = /^fewer_than_(\d+)_complete_years$/.exec(name)
      if (fewer) {
        return `Fewer than ${fewer[1]} complete years are available, which is too few for a trend estimate.`
      }
      return code.replace(/_/g, ' ')
    }
  }
}

/** Explains a per-metric `notes` code. */
export function describeNote(code: string): string {
  switch (code) {
    case 'low_statistical_power':
      return 'Fewer than 10 yearly observations: the test has little power and the estimate is unstable.'
    case 'constant_series':
      return 'Every year has the same value, so the slope is 0 and no p-value applies.'
    case 'event_years_only':
      return 'Uses only years that had at least one heatwave. Years without events are left out, not counted as zero.'
    case 'missing_metric_values_excluded':
      return 'Years with no value for this metric were left out.'
    case 'incomplete_years_excluded':
      return 'Incomplete years were left out.'
    case 'irregular_year_spacing':
      return 'Some years were left out, so the observations are not evenly spaced. The fit uses the real calendar years.'
    case 'fewer_than_min_observations':
      return 'Too few usable years to fit a trend.'
    case 'non_finite_regression_result':
      return 'The regression could not be computed reliably from these values.'
    default:
      return code.replace(/_/g, ' ')
  }
}

export function formatPValue(p: number | null): string {
  if (p === null) return '—'
  return p < 0.001 ? '< 0.001' : p.toFixed(3)
}
