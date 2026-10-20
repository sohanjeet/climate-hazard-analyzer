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

// ---------------------------------------------------------------------------------------------------------------
// GET /api/temperature-anomalies (backend/app/schemas/anomaly.py)

export type AnomalyYearStatus = 'complete' | 'partial_year' | 'low_coverage' | 'no_data'

export interface AnomalyMethod {
  method_version: string
  metric: string
  baseline_statistic: string
  anomaly_formula: string
  unit: string
  temperature_decimals: number
  coverage_decimals: number
  baseline_min_coverage: number
  year_min_coverage: number
  missing_value_policy: string
  incomplete_year_policy: string
}

export interface AnomalyBaseline {
  start_year: number
  end_year: number
  mean_daily_max_c: number
  observation_count: number
  expected_count: number
  coverage: number
  low_coverage_years: number[]
}

export interface AnnualAnomaly {
  year: number
  /** Null when the year has no valid observation. */
  annual_mean_daily_max_c: number | null
  /** Null unless `status` is "complete". */
  anomaly_c: number | null
  observation_count: number
  expected_count: number
  coverage: number
  status: AnomalyYearStatus
  warnings: string[]
}

export interface AnomalySummary {
  years_in_window: number
  complete_years: number
  mean_anomaly_c: number | null
  mean_annual_daily_max_c: number | null
  max_anomaly_c: number | null
  max_anomaly_year: number | null
  min_anomaly_c: number | null
  min_anomaly_year: number | null
  positive_years: number
  negative_years: number
  zero_years: number
}

export interface AnomalyDataQuality {
  analysis_coverage: number
  missing_day_count: number
  warnings: string[]
}

export interface TemperatureAnomalies {
  location_key: string
  analysis_type: string
  latitude: number
  longitude: number
  start_date: string
  end_date: string
  method: AnomalyMethod
  baseline: AnomalyBaseline
  annual: AnnualAnomaly[]
  summary: AnomalySummary
  data_quality: AnomalyDataQuality
  source: string
  computed_at: string
}

export interface AnomalyRequest {
  latitude: number
  longitude: number
  startDate: string
  endDate: string
  baselineStartYear?: number
  baselineEndYear?: number
}

// ---------------------------------------------------------------------------------------------------------------
// GET /api/geography/locations and /api/geography/coverage (backend/app/schemas/geography.py)

/** Always "observation_location": values for these points are never country or state aggregates. */
export type GeoScope = 'observation_location'

export type LocationRole = 'capital' | 'major_city'

export interface ObservationLocation {
  id: string
  name: string
  latitude: number
  longitude: number
  /** ISO 3166-1 alpha-3. */
  country_code: string
  country_name: string
  /** ISO 3166-2:IN for Indian locations. */
  region_code: string | null
  region_name: string | null
  role: LocationRole
  role_note: string | null
}

export interface LocationsResponse {
  scope: GeoScope
  scope_note: string
  count: number
  locations: ObservationLocation[]
}

export type CoverageStatus = 'stored' | 'partial' | 'not_stored'

export interface LocationCoverage {
  location_id: string
  baseline_stored_days: number
  baseline_expected_days: number
  window_stored_days: number
  window_expected_days: number
  status: CoverageStatus
}

export interface CoverageResponse {
  scope: GeoScope
  start_date: string
  end_date: string
  baseline_start_year: number
  baseline_end_year: number
  status_note: string
  locations: LocationCoverage[]
}

export interface CoverageRequest {
  startDate: string
  endDate: string
  country?: string
  region?: string
}
