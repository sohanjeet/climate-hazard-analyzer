import type { AnnualMetrics, HeatwaveAnalysis, MetricName, RollingStatus } from './api/types'

export type ChartMetricKey = 'heatwave_frequency' | 'total_heatwave_days' | 'mean_duration_days' | 'max_intensity_c'

export interface ChartMetricConfig {
  key: ChartMetricKey
  title: string
  /** Short axis / value unit, e.g. "events". */
  unit: string
  /** True when the metric is undefined (not zero) in a year without heatwaves. */
  eventDerived: boolean
  digits: number
  help: string
  read: (row: AnnualMetrics) => number | null
}

export const CHART_METRICS: readonly ChartMetricConfig[] = [
  {
    key: 'heatwave_frequency',
    title: 'Heatwave frequency',
    unit: 'events',
    eventDerived: false,
    digits: 0,
    help: 'Number of separate heatwave events that started in each calendar year. An event is at least 3 consecutive days above the baseline threshold.',
    read: (row) => row.heatwave_count,
  },
  {
    key: 'total_heatwave_days',
    title: 'Heatwave days',
    unit: 'days',
    eventDerived: false,
    digits: 0,
    help: 'Total days inside heatwave events that started in each calendar year. An event that runs into the next year is counted entirely in the year it started.',
    read: (row) => row.total_heatwave_days,
  },
  {
    key: 'mean_duration_days',
    title: 'Mean event duration',
    unit: 'days',
    eventDerived: true,
    digits: 1,
    help: 'Average length of the events that started in the year. Undefined in years without events, so those years have no bar rather than a zero.',
    read: (row) => row.mean_duration_days,
  },
  {
    key: 'max_intensity_c',
    title: 'Maximum intensity',
    unit: '°C above threshold',
    eventDerived: true,
    digits: 1,
    help: 'Largest single-day exceedance above the baseline threshold among the year’s events. Undefined in years without events.',
    read: (row) => row.max_intensity_c,
  },
]

/**
 * - complete: whole calendar year in the window with enough valid days
 * - incomplete: shown, but excluded from trends (partial year, or too many missing days)
 * - no_events: undefined metric, the year had no heatwave events
 * - no_data: not a single valid observation that year
 */
export type YearStatus = 'complete' | 'incomplete' | 'no_events' | 'no_data'

export interface ChartRow {
  year: number
  status: YearStatus
  /** The year's value, whichever bar it is drawn in; null when undefined or unobserved. */
  value: number | null
  completeValue: number | null
  incompleteValue: number | null
  rolling: number | null
  rollingStatus: RollingStatus | null
  gapYears: number[]
  coverage: number
  daysObserved: number
  daysExpected: number
}

export interface ChartSeries {
  rows: ChartRow[]
  hasIncomplete: boolean
  hasUnobserved: boolean
  hasNoEvents: boolean
  hasRolling: boolean
  rollingWindow: number | null
}

export function buildChartSeries(analysis: HeatwaveAnalysis, metric: ChartMetricConfig): ChartSeries {
  const trendMetric = analysis.trend?.metrics.find((m) => m.metric === (metric.key as MetricName))
  const rollingByYear = new Map(trendMetric?.rolling_average.points.map((p) => [p.year, p]) ?? [])

  const rows: ChartRow[] = analysis.annual.map((annual) => {
    const raw = metric.read(annual)
    let status: YearStatus
    let value: number | null = raw
    if (annual.days_observed === 0) {
      status = 'no_data'
      value = null // zero events here would only mean "nothing was observed"
    } else if (raw === null) {
      status = 'no_events'
    } else {
      status = annual.is_complete ? 'complete' : 'incomplete'
    }
    const point = rollingByYear.get(annual.year)
    return {
      year: annual.year,
      status,
      value,
      completeValue: status === 'complete' ? value : null,
      incompleteValue: status === 'incomplete' ? value : null,
      rolling: point?.rolling_mean ?? null,
      rollingStatus: point?.status ?? null,
      gapYears: point?.gap_years ?? [],
      coverage: annual.coverage,
      daysObserved: annual.days_observed,
      daysExpected: annual.days_expected,
    }
  })

  return {
    rows,
    hasIncomplete: rows.some((r) => r.status === 'incomplete'),
    hasUnobserved: rows.some((r) => r.status === 'no_data'),
    hasNoEvents: rows.some((r) => r.status === 'no_events'),
    hasRolling: rows.some((r) => r.rolling !== null),
    rollingWindow: trendMetric?.rolling_average.window_years ?? null,
  }
}

export const STATUS_LABEL: Record<YearStatus, string> = {
  complete: 'Complete year',
  incomplete: 'Incomplete year (not used in trends)',
  no_events: 'No heatwave events (value undefined)',
  no_data: 'No valid observations',
}

export function describeRollingStatus(status: RollingStatus | null, gapYears: number[], window: number | null): string {
  switch (status) {
    case 'ok':
      return `${window}-year mean`
    case 'year_unavailable':
      return 'Unavailable: this year is excluded or has no value'
    case 'gap_in_window':
      return `Unavailable: gap in window (${gapYears.join(', ')})`
    case 'insufficient_history':
      return 'Unavailable: window starts before the first analysed year'
    default:
      return 'Unavailable'
  }
}
