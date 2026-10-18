/**
 * Types for GET /api/heatwaves. They mirror backend/app/schemas/analysis.py and schemas/trend.py.
 * Dates arrive as ISO strings ("YYYY-MM-DD"); `computed_at` is an ISO datetime.
 */

export type MetricName =
  | 'heatwave_frequency'
  | 'total_heatwave_days'
  | 'mean_duration_days'
  | 'max_intensity_c'
  | 'mean_intensity_c'

export type TrendClassification = 'increasing' | 'decreasing' | 'no_significant_trend' | 'insufficient_data'

export type RollingStatus = 'ok' | 'year_unavailable' | 'gap_in_window' | 'insufficient_history'

export interface HeatwaveMethod {
  method_version: string
  threshold_method: string
  percentile: number
  interpolation: string
  comparison: string
  min_duration_days: number
  missing_day_policy: string
  year_attribution: string
  intensity_reference: string
  baseline_min_coverage: number
  year_min_coverage: number
}

export interface BaselineInfo {
  start_year: number
  end_year: number
  percentile: number
  threshold_c: number
  observation_count: number
  expected_count: number
  coverage: number
  exceedance_count: number
  low_coverage_years: number[]
}

export interface HeatwaveEvent {
  start_date: string
  end_date: string
  duration_days: number
  year: number
  peak_temperature_c: number
  mean_temperature_c: number
  max_exceedance_c: number
  mean_exceedance_c: number
  cumulative_exceedance_c: number
  censored_start: boolean
  censored_end: boolean
  adjacent_missing: boolean
}

export interface AnnualMetrics {
  year: number
  days_expected: number
  days_observed: number
  coverage: number
  is_complete: boolean
  heatwave_count: number
  total_heatwave_days: number
  mean_duration_days: number | null
  max_duration_days: number | null
  max_intensity_c: number | null
  mean_intensity_c: number | null
  peak_temperature_c: number | null
}

export interface HeatwaveSummary {
  total_events: number
  total_heatwave_days: number
  complete_years: number
  events_per_complete_year: number | null
  heatwave_days_per_complete_year: number | null
  mean_duration_days: number | null
  max_duration_days: number | null
  max_intensity_c: number | null
  mean_intensity_c: number | null
  peak_temperature_c: number | null
}

export interface DataQuality {
  analysis_coverage: number
  missing_dates: string[]
  warnings: string[]
}

export interface TrendMethod {
  method_version: string
  regression: string
  x_variable: string
  p_value_method: string
  significance_level: number
  min_observations: number
  low_power_observations: number
  included_years: string
  missing_value_policy: string
  zero_policy: string
  rolling_window_years: number
  rolling_alignment: string
  rolling_gap_policy: string
}

export interface RollingPoint {
  year: number
  value: number | null
  included: boolean
  rolling_mean: number | null
  status: RollingStatus
  gap_years: number[]
}

export interface RollingAverage {
  window_years: number
  alignment: string
  valid_points: number
  points: RollingPoint[]
}

export interface TrendMetric {
  metric: MetricName
  label: string
  unit: string
  classification: TrendClassification
  n_observations: number
  first_year: number | null
  last_year: number | null
  years_used: number[]
  missing_value_years: number[]
  excluded_incomplete_years: number[]
  zero_value_observations: number
  irregular_spacing: boolean
  slope_per_year: number | null
  slope_per_decade: number | null
  intercept: number | null
  r_squared: number | null
  p_value: number | null
  std_err: number | null
  p_value_supported: boolean
  notes: string[]
  rolling_average: RollingAverage
}

export interface TrendInsight {
  metric: MetricName
  classification: TrendClassification
  statement: string
}

export interface TrendAnalysis {
  method: TrendMethod
  complete_years_used: number
  first_complete_year: number | null
  last_complete_year: number | null
  metrics: TrendMetric[]
  insights: TrendInsight[]
  interpretation_note: string
  warnings: string[]
}

export interface HeatwaveAnalysis {
  location_key: string
  analysis_type: string
  latitude: number
  longitude: number
  start_date: string
  end_date: string
  method: HeatwaveMethod
  params_hash: string
  baseline: BaselineInfo
  events: HeatwaveEvent[]
  annual: AnnualMetrics[]
  summary: HeatwaveSummary
  /** Optional in the backend schema (absent on older stored results). */
  trend: TrendAnalysis | null
  data_quality: DataQuality
  source: string
  computed_at: string
}

export interface HeatwaveRequest {
  latitude: number
  longitude: number
  startDate: string
  endDate: string
  rollingWindowYears?: number
  baselineStartYear?: number
  baselineEndYear?: number
}

/** One entry of `detail.errors` in a 422 body produced by backend/app/errors.py. */
export interface FieldError {
  field: string
  message: string
}
