import type { AnnualAnomaly, AnomalyYearStatus, TemperatureAnomalies } from './api/types'

export interface AnomalyRow {
  year: number
  status: AnomalyYearStatus
  /** Annual mean daily maximum plotted on the line chart; null unless the year is complete. */
  meanDailyMax: number | null
  /** Signed anomaly; null unless the year is complete. A real 0 stays 0. */
  anomaly: number | null
  /** The two bar series; exactly one is set for a non-zero anomaly. */
  positive: number | null
  negative: number | null
  /** Reported mean even for incomplete years (shown in the table, never plotted). */
  reportedMean: number | null
  observed: number
  expected: number
  coverage: number
}

export interface AnomalyChartData {
  rows: AnomalyRow[]
  baselineMean: number
  baselineLabel: string
  hasAnomaly: boolean
  incompleteYears: number
}

function toRow(annual: AnnualAnomaly): AnomalyRow {
  const complete = annual.status === 'complete'
  const anomaly = complete ? annual.anomaly_c : null
  return {
    year: annual.year,
    status: annual.status,
    meanDailyMax: complete ? annual.annual_mean_daily_max_c : null,
    anomaly,
    positive: anomaly !== null && anomaly > 0 ? anomaly : null,
    negative: anomaly !== null && anomaly < 0 ? anomaly : null,
    reportedMean: annual.annual_mean_daily_max_c,
    observed: annual.observation_count,
    expected: annual.expected_count,
    coverage: annual.coverage,
  }
}

export function buildAnomalyChart(data: TemperatureAnomalies): AnomalyChartData {
  const rows = data.annual.map(toRow)
  return {
    rows,
    baselineMean: data.baseline.mean_daily_max_c,
    baselineLabel: `${data.baseline.start_year}–${data.baseline.end_year}`,
    hasAnomaly: rows.some((r) => r.anomaly !== null),
    incompleteYears: rows.filter((r) => r.status !== 'complete').length,
  }
}

export const ANOMALY_STATUS_LABEL: Record<AnomalyYearStatus, string> = {
  complete: 'Complete year',
  partial_year: 'Partial year (anomaly withheld)',
  low_coverage: 'Too many missing days (anomaly withheld)',
  no_data: 'No valid observations',
}

/** Words for the sign, so the direction never depends on colour or bar position alone. */
export function describeAnomalySign(value: number | null): string {
  if (value === null) return 'not available'
  if (value > 0) return 'warmer than the baseline'
  if (value < 0) return 'cooler than the baseline'
  return 'equal to the baseline'
}
