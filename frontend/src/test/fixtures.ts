import type {
  AnnualAnomaly,
  AnnualMetrics,
  HeatwaveAnalysis,
  HeatwaveEvent,
  MetricName,
  RollingPoint,
  TemperatureAnomalies,
  TrendAnalysis,
  TrendClassification,
  TrendMetric,
} from '@/lib/api/types'

/**
 * Synthetic response builder shaped exactly like GET /api/heatwaves. The numbers are made up for UI tests and
 * stand for no real place or observation. A real captured response is exercised in live-sample.test.ts.
 */

const COUNTS: Record<number, number> = { 2018: 0, 2019: 1, 2020: 2, 2021: 1, 2022: 3, 2023: 2, 2024: 4 }
const MEAN_DURATION: Record<number, number | null> = {
  2018: null,
  2019: 4,
  2020: 3.5,
  2021: 3,
  2022: 4.3,
  2023: 5,
  2024: 4.75,
}

export interface FixtureOptions {
  /** Years flagged incomplete (partial year or too many missing days). */
  incompleteYears?: number[]
  /** Years with no valid observation at all. */
  unobservedYears?: number[]
  noEvents?: boolean
  trend?: 'default' | 'none' | 'insufficient'
  missingDates?: string[]
  warnings?: string[]
  baselineLowCoverageYears?: number[]
  rollingWindow?: number
  latitude?: number
  longitude?: number
}

const METRIC_DEFS: { metric: MetricName; label: string; unit: string; read: (a: AnnualMetrics) => number | null }[] = [
  { metric: 'heatwave_frequency', label: 'Heatwave frequency', unit: 'events', read: (a) => a.heatwave_count },
  { metric: 'total_heatwave_days', label: 'Total heatwave days', unit: 'days', read: (a) => a.total_heatwave_days },
  { metric: 'mean_duration_days', label: 'Mean heatwave duration', unit: 'days', read: (a) => a.mean_duration_days },
  { metric: 'max_intensity_c', label: 'Maximum heatwave intensity', unit: '°C above threshold', read: (a) => a.max_intensity_c },
  { metric: 'mean_intensity_c', label: 'Mean heatwave intensity', unit: '°C above threshold', read: (a) => a.mean_intensity_c },
]

function buildAnnual(year: number, options: FixtureOptions): AnnualMetrics {
  const unobserved = options.unobservedYears?.includes(year) ?? false
  const incomplete = unobserved || (options.incompleteYears?.includes(year) ?? false)
  const events = unobserved || options.noEvents ? 0 : COUNTS[year] ?? 0
  const meanDuration = events === 0 ? null : MEAN_DURATION[year] ?? 3
  const days = meanDuration === null ? 0 : Math.round(meanDuration * events)
  const expected = year % 4 === 0 ? 366 : 365
  const observed = unobserved ? 0 : incomplete ? Math.round(expected * 0.6) : expected
  return {
    year,
    days_expected: expected,
    days_observed: observed,
    coverage: observed / expected,
    is_complete: !incomplete,
    heatwave_count: events,
    total_heatwave_days: days,
    mean_duration_days: meanDuration,
    max_duration_days: events === 0 ? null : 6,
    max_intensity_c: events === 0 ? null : 2 + events * 0.5,
    mean_intensity_c: events === 0 ? null : 1.2 + events * 0.1,
    peak_temperature_c: events === 0 ? null : 41 + events * 0.3,
  }
}

function classificationFor(metric: MetricName, nUsed: number): TrendClassification {
  if (nUsed < 3) return 'insufficient_data'
  return metric === 'heatwave_frequency' || metric === 'total_heatwave_days' ? 'increasing' : 'no_significant_trend'
}

function buildTrend(annual: AnnualMetrics[], options: FixtureOptions): TrendAnalysis {
  const window = options.rollingWindow ?? 3
  const complete = annual.filter((a) => a.is_complete)
  const metrics: TrendMetric[] = METRIC_DEFS.map((def) => {
    const usable = complete.filter((a) => def.read(a) !== null)
    const n = usable.length
    const classification = classificationFor(def.metric, n)
    const supported = n >= 3
    const eventDerived = def.metric.includes('duration') || def.metric.includes('intensity')
    const points: RollingPoint[] = annual.map((a, index) => {
      const value = def.read(a)
      const included = a.is_complete && value !== null
      const windowRows = annual.slice(Math.max(0, index - window + 1), index + 1)
      if (!included) {
        return { year: a.year, value, included, rolling_mean: null, status: 'year_unavailable', gap_years: [] }
      }
      if (windowRows.length < window) {
        return { year: a.year, value, included, rolling_mean: null, status: 'insufficient_history', gap_years: [] }
      }
      const gaps = windowRows.filter((w) => !w.is_complete || def.read(w) === null).map((w) => w.year)
      if (gaps.length > 0) {
        return { year: a.year, value, included, rolling_mean: null, status: 'gap_in_window', gap_years: gaps }
      }
      const mean = windowRows.reduce((sum, w) => sum + (def.read(w) as number), 0) / window
      return { year: a.year, value, included, rolling_mean: mean, status: 'ok', gap_years: [] }
    })
    return {
      metric: def.metric,
      label: def.label,
      unit: def.unit,
      classification,
      n_observations: n,
      first_year: n ? usable[0].year : null,
      last_year: n ? usable[n - 1].year : null,
      years_used: usable.map((a) => a.year),
      missing_value_years: eventDerived ? complete.filter((a) => def.read(a) === null).map((a) => a.year) : [],
      excluded_incomplete_years: annual.filter((a) => !a.is_complete).map((a) => a.year),
      zero_value_observations: 0,
      irregular_spacing: false,
      slope_per_year: supported ? 0.12 : null,
      slope_per_decade: supported ? 1.2 : null,
      intercept: supported ? -240 : null,
      r_squared: supported ? 0.61 : null,
      p_value: supported ? (classification === 'increasing' ? 0.021 : 0.34) : null,
      std_err: supported ? 0.04 : null,
      p_value_supported: supported,
      notes: [
        ...(n < 10 && n >= 3 ? ['low_statistical_power'] : []),
        ...(eventDerived ? ['event_years_only'] : []),
        ...(n < 3 ? ['fewer_than_min_observations'] : []),
      ],
      rolling_average: {
        window_years: window,
        alignment: 'trailing',
        valid_points: points.filter((p) => p.rolling_mean !== null).length,
        points,
      },
    }
  })
  return {
    method: {
      method_version: 'trend-v1',
      regression: 'ols',
      x_variable: 'calendar_year',
      p_value_method: 'two_sided_t_test',
      significance_level: 0.05,
      min_observations: 3,
      low_power_observations: 10,
      included_years: 'complete_years_only',
      missing_value_policy: 'exclude',
      zero_policy: 'zero_is_value',
      rolling_window_years: window,
      rolling_alignment: 'trailing',
      rolling_gap_policy: 'no_bridging',
    },
    complete_years_used: complete.length,
    first_complete_year: complete[0]?.year ?? null,
    last_complete_year: complete[complete.length - 1]?.year ?? null,
    metrics,
    insights: metrics.map((m) => ({
      metric: m.metric,
      classification: m.classification,
      statement:
        m.classification === 'increasing'
          ? `${m.label}: statistically significant linear increase of 1.20 ${m.unit} per decade (p = 0.021, R² = 0.61, n = ${m.n_observations}). This is an association within this series and does not establish its cause.`
          : m.classification === 'insufficient_data'
            ? `${m.label}: insufficient data. ${m.n_observations} usable complete-year observation(s); at least 3 are needed for a trend estimate.`
            : `${m.label}: no statistically significant linear trend at the 0.05 level (+1.20 ${m.unit} per decade, p = 0.340, n = ${m.n_observations}). This does not show that no change occurred.`,
    })),
    interpretation_note:
      'Trends describe linear change in this single grid-cell series over the analysed years. A statistically significant trend is an association within these data; it does not by itself establish the cause of the change.',
    warnings: complete.length < annual.length ? ['incomplete_years_excluded'] : [],
  }
}

function buildEvents(annual: AnnualMetrics[]): HeatwaveEvent[] {
  return annual.flatMap((a) =>
    Array.from({ length: a.heatwave_count }, (_, i): HeatwaveEvent => ({
      start_date: `${a.year}-0${5 + i}-10`,
      end_date: `${a.year}-0${5 + i}-13`,
      duration_days: 4,
      year: a.year,
      peak_temperature_c: 42,
      mean_temperature_c: 41,
      max_exceedance_c: 2.5,
      mean_exceedance_c: 1.8,
      cumulative_exceedance_c: 7.2,
      censored_start: false,
      censored_end: false,
      adjacent_missing: false,
    })),
  )
}

export function makeAnalysis(options: FixtureOptions = {}): HeatwaveAnalysis {
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024]
  const annual = years.map((year) => buildAnnual(year, options))
  const events = buildEvents(annual)
  const totalDays = annual.reduce((sum, a) => sum + a.total_heatwave_days, 0)
  const complete = annual.filter((a) => a.is_complete)
  const trend = options.trend === 'none' ? null : buildTrend(options.trend === 'insufficient' ? annual.map((a, i) => (i < 5 ? { ...a, is_complete: false } : a)) : annual, options)
  return {
    location_key: '28.6139,77.2090',
    analysis_type: 'heatwave',
    latitude: options.latitude ?? 28.6139,
    longitude: options.longitude ?? 77.209,
    start_date: '2018-01-01',
    end_date: '2024-12-31',
    method: {
      method_version: 'heatwave-v1',
      threshold_method: 'annual_fixed_baseline',
      percentile: 95,
      interpolation: 'linear',
      comparison: 'gt',
      min_duration_days: 3,
      missing_day_policy: 'breaks_event',
      year_attribution: 'event_start_date',
      intensity_reference: 'exceedance_above_threshold',
      baseline_min_coverage: 0.9,
      year_min_coverage: 0.95,
    },
    params_hash: 'abc123',
    baseline: {
      start_year: 1991,
      end_year: 2020,
      percentile: 95,
      threshold_c: 39.6,
      observation_count: 10957,
      expected_count: 10957,
      coverage: 1,
      exceedance_count: 548,
      low_coverage_years: options.baselineLowCoverageYears ?? [],
    },
    events,
    annual,
    summary: {
      total_events: events.length,
      total_heatwave_days: totalDays,
      complete_years: complete.length,
      events_per_complete_year: complete.length ? complete.reduce((s, a) => s + a.heatwave_count, 0) / complete.length : null,
      heatwave_days_per_complete_year: complete.length ? complete.reduce((s, a) => s + a.total_heatwave_days, 0) / complete.length : null,
      mean_duration_days: events.length ? totalDays / events.length : null,
      max_duration_days: events.length ? 6 : null,
      max_intensity_c: events.length ? 4.5 : null,
      mean_intensity_c: events.length ? 1.9 : null,
      peak_temperature_c: events.length ? 43.2 : null,
    },
    trend,
    data_quality: {
      analysis_coverage: options.missingDates?.length ? 0.99 : 1,
      missing_dates: options.missingDates ?? [],
      warnings: options.warnings ?? [],
    },
    source: 'open-meteo-archive',
    computed_at: '2026-10-14T12:30:00Z',
  }
}

export interface AnomalyFixtureOptions {
  /** Whole years requested but with too many missing days: mean reported, anomaly withheld. */
  lowCoverageYears?: number[]
  /** Years without a single valid observation. */
  unobservedYears?: number[]
  /** Years only partly inside the requested window. */
  partialYears?: number[]
  warnings?: string[]
  baselineMean?: number
  /** Added to every annual anomaly, to tell fixtures for different places apart. */
  shift?: number
  latitude?: number
  longitude?: number
}

const ANOMALIES: Record<number, number> = { 2018: 0.4, 2019: -0.3, 2020: 0.9, 2021: 0, 2022: 1.2, 2023: 1.6, 2024: 1.1 }

/** Synthetic response shaped like GET /api/temperature-anomalies. The numbers are made up for UI tests. */
export function makeAnomalies(options: AnomalyFixtureOptions = {}): TemperatureAnomalies {
  const baseline = options.baselineMean ?? 30.8
  const shift = options.shift ?? 0
  const round = (v: number) => Math.round(v * 100) / 100
  const annual: AnnualAnomaly[] = Object.keys(ANOMALIES).map(Number).map((year) => {
    const expected = year % 4 === 0 ? 366 : 365
    const unobserved = options.unobservedYears?.includes(year) ?? false
    const low = options.lowCoverageYears?.includes(year) ?? false
    const partial = options.partialYears?.includes(year) ?? false
    const mean = round(baseline + ANOMALIES[year] + shift)
    if (unobserved) {
      return { year, annual_mean_daily_max_c: null, anomaly_c: null, observation_count: 0, expected_count: expected, coverage: 0, status: 'no_data', warnings: ['no_valid_observations'] }
    }
    if (low || partial) {
      const observed = Math.round(expected * (partial ? 0.5 : 0.6))
      return {
        year,
        annual_mean_daily_max_c: mean,
        anomaly_c: null,
        observation_count: observed,
        expected_count: partial ? observed : expected,
        coverage: partial ? 1 : 0.6,
        status: partial ? 'partial_year' : 'low_coverage',
        warnings: [partial ? 'partial_year' : 'low_coverage'],
      }
    }
    return {
      year,
      annual_mean_daily_max_c: mean,
      anomaly_c: round(ANOMALIES[year] + shift),
      observation_count: expected,
      expected_count: expected,
      coverage: 1,
      status: 'complete',
      warnings: [],
    }
  })
  const complete = annual.filter((a) => a.status === 'complete')
  const anomalies = complete.map((a) => a.anomaly_c as number)
  const mean = (values: number[]) => (values.length ? round(values.reduce((s, v) => s + v, 0) / values.length) : null)
  const warm = complete.length ? complete.reduce((best, a) => ((a.anomaly_c as number) > (best.anomaly_c as number) ? a : best)) : null
  const cool = complete.length ? complete.reduce((best, a) => ((a.anomaly_c as number) < (best.anomaly_c as number) ? a : best)) : null
  return {
    location_key: '28.6139,77.2090',
    analysis_type: 'temperature_anomaly',
    latitude: options.latitude ?? 28.6139,
    longitude: options.longitude ?? 77.209,
    start_date: '2018-01-01',
    end_date: '2024-12-31',
    method: {
      method_version: 'temperature-anomaly-v1',
      metric: 'annual_mean_of_daily_maximum_temperature_2m',
      baseline_statistic: 'mean_of_valid_daily_maxima_over_baseline_period',
      anomaly_formula: 'annual_mean_daily_max_c - baseline_mean_daily_max_c',
      unit: 'celsius',
      temperature_decimals: 2,
      coverage_decimals: 4,
      baseline_min_coverage: 0.9,
      year_min_coverage: 0.95,
      missing_value_policy: 'excluded_never_filled',
      incomplete_year_policy: 'annual_mean_reported_anomaly_withheld',
    },
    baseline: {
      start_year: 1991,
      end_year: 2020,
      mean_daily_max_c: baseline,
      observation_count: 10958,
      expected_count: 10958,
      coverage: 1,
      low_coverage_years: [],
    },
    annual,
    summary: {
      years_in_window: annual.length,
      complete_years: complete.length,
      mean_anomaly_c: mean(anomalies),
      mean_annual_daily_max_c: mean(complete.map((a) => a.annual_mean_daily_max_c as number)),
      max_anomaly_c: warm?.anomaly_c ?? null,
      max_anomaly_year: warm?.year ?? null,
      min_anomaly_c: cool?.anomaly_c ?? null,
      min_anomaly_year: cool?.year ?? null,
      positive_years: anomalies.filter((v) => v > 0).length,
      negative_years: anomalies.filter((v) => v < 0).length,
      zero_years: anomalies.filter((v) => v === 0).length,
    },
    data_quality: {
      analysis_coverage: 1,
      missing_day_count: 0,
      warnings: options.warnings ?? [],
    },
    source: 'open-meteo-archive',
    computed_at: '2026-10-14T12:30:00Z',
  }
}
