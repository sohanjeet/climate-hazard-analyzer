import { ApiError } from './errors'
import type {
  AnnualMetrics,
  BaselineInfo,
  DataQuality,
  HeatwaveAnalysis,
  HeatwaveEvent,
  HeatwaveMethod,
  HeatwaveSummary,
  MetricName,
  RollingAverage,
  RollingPoint,
  RollingStatus,
  TrendAnalysis,
  TrendClassification,
  TrendInsight,
  TrendMetric,
  TrendMethod,
} from './types'

/**
 * Runtime validation of a /api/heatwaves body. Only the shape the dashboard relies on is checked, extra
 * fields are ignored (as the backend schemas do), and a mismatch throws an `invalid_response` ApiError that
 * names the offending path rather than rendering partial or wrong numbers.
 */

type Rec = Record<string, unknown>

class ShapeError extends Error {}

function fail(path: string, expected: string): never {
  throw new ShapeError(`${path} should be ${expected}`)
}

function rec(value: unknown, path: string): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object')
  return value as Rec
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string')
  return value
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number')
  return value
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'a boolean')
  return value
}

function nullable<T>(value: unknown, path: string, inner: (v: unknown, p: string) => T): T | null {
  return value === null ? null : inner(value, path)
}

function arr<T>(value: unknown, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, 'an array')
  return value.map((v, i) => item(v, `${path}[${i}]`))
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, `one of ${allowed.join(', ')}`)
  return value as T
}

const isoDate = (v: unknown, p: string): string => {
  const s = str(v, p)
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) fail(p, 'an ISO date')
  return s
}

const METRICS: readonly MetricName[] = [
  'heatwave_frequency',
  'total_heatwave_days',
  'mean_duration_days',
  'max_intensity_c',
  'mean_intensity_c',
]
const CLASSIFICATIONS: readonly TrendClassification[] = [
  'increasing',
  'decreasing',
  'no_significant_trend',
  'insufficient_data',
]
const ROLLING_STATUSES: readonly RollingStatus[] = ['ok', 'year_unavailable', 'gap_in_window', 'insufficient_history']

function parseMethod(v: unknown, p: string): HeatwaveMethod {
  const o = rec(v, p)
  return {
    method_version: str(o.method_version, `${p}.method_version`),
    threshold_method: str(o.threshold_method, `${p}.threshold_method`),
    percentile: num(o.percentile, `${p}.percentile`),
    interpolation: str(o.interpolation, `${p}.interpolation`),
    comparison: str(o.comparison, `${p}.comparison`),
    min_duration_days: num(o.min_duration_days, `${p}.min_duration_days`),
    missing_day_policy: str(o.missing_day_policy, `${p}.missing_day_policy`),
    year_attribution: str(o.year_attribution, `${p}.year_attribution`),
    intensity_reference: str(o.intensity_reference, `${p}.intensity_reference`),
    baseline_min_coverage: num(o.baseline_min_coverage, `${p}.baseline_min_coverage`),
    year_min_coverage: num(o.year_min_coverage, `${p}.year_min_coverage`),
  }
}

function parseBaseline(v: unknown, p: string): BaselineInfo {
  const o = rec(v, p)
  return {
    start_year: num(o.start_year, `${p}.start_year`),
    end_year: num(o.end_year, `${p}.end_year`),
    percentile: num(o.percentile, `${p}.percentile`),
    threshold_c: num(o.threshold_c, `${p}.threshold_c`),
    observation_count: num(o.observation_count, `${p}.observation_count`),
    expected_count: num(o.expected_count, `${p}.expected_count`),
    coverage: num(o.coverage, `${p}.coverage`),
    exceedance_count: num(o.exceedance_count, `${p}.exceedance_count`),
    low_coverage_years: arr(o.low_coverage_years, `${p}.low_coverage_years`, num),
  }
}

function parseEvent(v: unknown, p: string): HeatwaveEvent {
  const o = rec(v, p)
  return {
    start_date: isoDate(o.start_date, `${p}.start_date`),
    end_date: isoDate(o.end_date, `${p}.end_date`),
    duration_days: num(o.duration_days, `${p}.duration_days`),
    year: num(o.year, `${p}.year`),
    peak_temperature_c: num(o.peak_temperature_c, `${p}.peak_temperature_c`),
    mean_temperature_c: num(o.mean_temperature_c, `${p}.mean_temperature_c`),
    max_exceedance_c: num(o.max_exceedance_c, `${p}.max_exceedance_c`),
    mean_exceedance_c: num(o.mean_exceedance_c, `${p}.mean_exceedance_c`),
    cumulative_exceedance_c: num(o.cumulative_exceedance_c, `${p}.cumulative_exceedance_c`),
    censored_start: bool(o.censored_start, `${p}.censored_start`),
    censored_end: bool(o.censored_end, `${p}.censored_end`),
    adjacent_missing: bool(o.adjacent_missing, `${p}.adjacent_missing`),
  }
}

function parseAnnual(v: unknown, p: string): AnnualMetrics {
  const o = rec(v, p)
  const n = (key: string) => nullable(o[key], `${p}.${key}`, num)
  return {
    year: num(o.year, `${p}.year`),
    days_expected: num(o.days_expected, `${p}.days_expected`),
    days_observed: num(o.days_observed, `${p}.days_observed`),
    coverage: num(o.coverage, `${p}.coverage`),
    is_complete: bool(o.is_complete, `${p}.is_complete`),
    heatwave_count: num(o.heatwave_count, `${p}.heatwave_count`),
    total_heatwave_days: num(o.total_heatwave_days, `${p}.total_heatwave_days`),
    mean_duration_days: n('mean_duration_days'),
    max_duration_days: n('max_duration_days'),
    max_intensity_c: n('max_intensity_c'),
    mean_intensity_c: n('mean_intensity_c'),
    peak_temperature_c: n('peak_temperature_c'),
  }
}

function parseSummary(v: unknown, p: string): HeatwaveSummary {
  const o = rec(v, p)
  const n = (key: string) => nullable(o[key], `${p}.${key}`, num)
  return {
    total_events: num(o.total_events, `${p}.total_events`),
    total_heatwave_days: num(o.total_heatwave_days, `${p}.total_heatwave_days`),
    complete_years: num(o.complete_years, `${p}.complete_years`),
    events_per_complete_year: n('events_per_complete_year'),
    heatwave_days_per_complete_year: n('heatwave_days_per_complete_year'),
    mean_duration_days: n('mean_duration_days'),
    max_duration_days: n('max_duration_days'),
    max_intensity_c: n('max_intensity_c'),
    mean_intensity_c: n('mean_intensity_c'),
    peak_temperature_c: n('peak_temperature_c'),
  }
}

function parseDataQuality(v: unknown, p: string): DataQuality {
  const o = rec(v, p)
  return {
    analysis_coverage: num(o.analysis_coverage, `${p}.analysis_coverage`),
    missing_dates: arr(o.missing_dates, `${p}.missing_dates`, isoDate),
    warnings: arr(o.warnings, `${p}.warnings`, str),
  }
}

function parseTrendMethod(v: unknown, p: string): TrendMethod {
  const o = rec(v, p)
  return {
    method_version: str(o.method_version, `${p}.method_version`),
    regression: str(o.regression, `${p}.regression`),
    x_variable: str(o.x_variable, `${p}.x_variable`),
    p_value_method: str(o.p_value_method, `${p}.p_value_method`),
    significance_level: num(o.significance_level, `${p}.significance_level`),
    min_observations: num(o.min_observations, `${p}.min_observations`),
    low_power_observations: num(o.low_power_observations, `${p}.low_power_observations`),
    included_years: str(o.included_years, `${p}.included_years`),
    missing_value_policy: str(o.missing_value_policy, `${p}.missing_value_policy`),
    zero_policy: str(o.zero_policy, `${p}.zero_policy`),
    rolling_window_years: num(o.rolling_window_years, `${p}.rolling_window_years`),
    rolling_alignment: str(o.rolling_alignment, `${p}.rolling_alignment`),
    rolling_gap_policy: str(o.rolling_gap_policy, `${p}.rolling_gap_policy`),
  }
}

function parseRollingPoint(v: unknown, p: string): RollingPoint {
  const o = rec(v, p)
  return {
    year: num(o.year, `${p}.year`),
    value: nullable(o.value, `${p}.value`, num),
    included: bool(o.included, `${p}.included`),
    rolling_mean: nullable(o.rolling_mean, `${p}.rolling_mean`, num),
    status: oneOf(o.status, `${p}.status`, ROLLING_STATUSES),
    gap_years: arr(o.gap_years, `${p}.gap_years`, num),
  }
}

function parseRolling(v: unknown, p: string): RollingAverage {
  const o = rec(v, p)
  return {
    window_years: num(o.window_years, `${p}.window_years`),
    alignment: str(o.alignment, `${p}.alignment`),
    valid_points: num(o.valid_points, `${p}.valid_points`),
    points: arr(o.points, `${p}.points`, parseRollingPoint),
  }
}

function parseTrendMetric(v: unknown, p: string): TrendMetric {
  const o = rec(v, p)
  const n = (key: string) => nullable(o[key], `${p}.${key}`, num)
  return {
    metric: oneOf(o.metric, `${p}.metric`, METRICS),
    label: str(o.label, `${p}.label`),
    unit: str(o.unit, `${p}.unit`),
    classification: oneOf(o.classification, `${p}.classification`, CLASSIFICATIONS),
    n_observations: num(o.n_observations, `${p}.n_observations`),
    first_year: n('first_year'),
    last_year: n('last_year'),
    years_used: arr(o.years_used, `${p}.years_used`, num),
    missing_value_years: arr(o.missing_value_years, `${p}.missing_value_years`, num),
    excluded_incomplete_years: arr(o.excluded_incomplete_years, `${p}.excluded_incomplete_years`, num),
    zero_value_observations: num(o.zero_value_observations, `${p}.zero_value_observations`),
    irregular_spacing: bool(o.irregular_spacing, `${p}.irregular_spacing`),
    slope_per_year: n('slope_per_year'),
    slope_per_decade: n('slope_per_decade'),
    intercept: n('intercept'),
    r_squared: n('r_squared'),
    p_value: n('p_value'),
    std_err: n('std_err'),
    p_value_supported: bool(o.p_value_supported, `${p}.p_value_supported`),
    notes: arr(o.notes, `${p}.notes`, str),
    rolling_average: parseRolling(o.rolling_average, `${p}.rolling_average`),
  }
}

function parseInsight(v: unknown, p: string): TrendInsight {
  const o = rec(v, p)
  return {
    metric: oneOf(o.metric, `${p}.metric`, METRICS),
    classification: oneOf(o.classification, `${p}.classification`, CLASSIFICATIONS),
    statement: str(o.statement, `${p}.statement`),
  }
}

function parseTrend(v: unknown, p: string): TrendAnalysis {
  const o = rec(v, p)
  return {
    method: parseTrendMethod(o.method, `${p}.method`),
    complete_years_used: num(o.complete_years_used, `${p}.complete_years_used`),
    first_complete_year: nullable(o.first_complete_year, `${p}.first_complete_year`, num),
    last_complete_year: nullable(o.last_complete_year, `${p}.last_complete_year`, num),
    metrics: arr(o.metrics, `${p}.metrics`, parseTrendMetric),
    insights: arr(o.insights, `${p}.insights`, parseInsight),
    interpretation_note: str(o.interpretation_note, `${p}.interpretation_note`),
    warnings: arr(o.warnings, `${p}.warnings`, str),
  }
}

export function parseHeatwaveAnalysis(body: unknown): HeatwaveAnalysis {
  try {
    const o = rec(body, 'response')
    return {
      location_key: str(o.location_key, 'location_key'),
      analysis_type: str(o.analysis_type, 'analysis_type'),
      latitude: num(o.latitude, 'latitude'),
      longitude: num(o.longitude, 'longitude'),
      start_date: isoDate(o.start_date, 'start_date'),
      end_date: isoDate(o.end_date, 'end_date'),
      method: parseMethod(o.method, 'method'),
      params_hash: str(o.params_hash, 'params_hash'),
      baseline: parseBaseline(o.baseline, 'baseline'),
      events: arr(o.events, 'events', parseEvent),
      annual: arr(o.annual, 'annual', parseAnnual),
      summary: parseSummary(o.summary, 'summary'),
      trend: o.trend === undefined || o.trend === null ? null : parseTrend(o.trend, 'trend'),
      data_quality: parseDataQuality(o.data_quality, 'data_quality'),
      source: str(o.source, 'source'),
      computed_at: str(o.computed_at, 'computed_at'),
    }
  } catch (error) {
    if (error instanceof ShapeError) {
      throw new ApiError('invalid_response', error.message)
    }
    throw error
  }
}
