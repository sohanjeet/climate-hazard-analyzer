import type { ApiError } from './api/errors'
import type {
  HeatwaveAnalysis,
  TemperatureAnomalies,
  TrendClassification,
} from './api/types'
import { formatCoordinates } from './format'
import { LIMITS, parseCoordinate, validateDateRange } from './validation'

/**
 * Pure helpers for the multi-city comparison: the location list rules, per-city metric extraction and chart
 * series. Every metric is read from the existing /api/heatwaves and /api/temperature-anomalies responses, so
 * nothing is recomputed here except simple selections (no new averages with their own denominators).
 */

export const MIN_LOCATIONS = 2
export const MAX_LOCATIONS = 4

export interface ComparisonLocation {
  /** Coordinates rounded to 4 decimals; two locations with the same id are duplicates. */
  id: string
  name: string
  latitude: number
  longitude: number
  /** Stable colour/marker slot 0-3. Follows the location, so removing another city never repaints it. */
  slot: number
}

export const PRESET_LOCATIONS = [
  { name: 'Delhi', latitude: 28.6139, longitude: 77.209 },
  { name: 'Mumbai', latitude: 19.076, longitude: 72.8777 },
  { name: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 },
  { name: 'Chennai', latitude: 13.0827, longitude: 80.2707 },
] as const

export function locationId(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`
}

function freeSlot(locations: readonly ComparisonLocation[]): number {
  const used = new Set(locations.map((l) => l.slot))
  for (let slot = 0; slot < MAX_LOCATIONS; slot += 1) if (!used.has(slot)) return slot
  return -1
}

export type AddResult = { ok: true; locations: ComparisonLocation[] } | { ok: false; error: string }

/** Adds a location unless the list is full or already contains the same coordinates. */
export function addLocation(
  locations: readonly ComparisonLocation[],
  candidate: { name: string; latitude: number; longitude: number },
): AddResult {
  const id = locationId(candidate.latitude, candidate.longitude)
  if (locations.length >= MAX_LOCATIONS) {
    return { ok: false, error: `You can compare at most ${MAX_LOCATIONS} locations. Remove one first.` }
  }
  const existing = locations.find((l) => l.id === id)
  if (existing) {
    return { ok: false, error: `${existing.name} already uses these coordinates (${formatCoordinates(existing.latitude, existing.longitude)}).` }
  }
  const slot = freeSlot(locations)
  return {
    ok: true,
    locations: [...locations, { id, name: candidate.name, latitude: candidate.latitude, longitude: candidate.longitude, slot }],
  }
}

export function removeLocation(locations: readonly ComparisonLocation[], id: string): ComparisonLocation[] {
  return locations.filter((l) => l.id !== id)
}

export interface CustomLocationErrors {
  latitude?: string
  longitude?: string
  name?: string
}

const MAX_NAME_LENGTH = 40

/** Validates the custom-location inputs. A blank name becomes "Custom (lat, lon)". */
export function validateCustomLocation(input: { name: string; latitude: string; longitude: string }): {
  errors: CustomLocationErrors
  candidate: { name: string; latitude: number; longitude: number } | null
} {
  const errors: CustomLocationErrors = {}
  const lat = parseCoordinate(input.latitude, 'latitude', LIMITS.latitude.min, LIMITS.latitude.max)
  const lon = parseCoordinate(input.longitude, 'longitude', LIMITS.longitude.min, LIMITS.longitude.max)
  if (lat.error) errors.latitude = lat.error
  if (lon.error) errors.longitude = lon.error
  const name = input.name.trim()
  if (name.length > MAX_NAME_LENGTH) errors.name = `Use at most ${MAX_NAME_LENGTH} characters.`
  if (lat.value === undefined || lon.value === undefined || errors.name) return { errors, candidate: null }
  return {
    errors,
    candidate: { name: name || `Custom (${formatCoordinates(lat.value, lon.value)})`, latitude: lat.value, longitude: lon.value },
  }
}

export { validateDateRange }

// --------------------------------------------------------------------------------------------- per-city state

export type Part<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError }

export interface CityResult {
  location: ComparisonLocation
  heatwave: Part<HeatwaveAnalysis>
  anomaly: Part<TemperatureAnomalies>
}

export function isLoading(city: CityResult): boolean {
  return city.heatwave.status === 'loading' || city.anomaly.status === 'loading'
}

export function hasError(city: CityResult): boolean {
  return city.heatwave.status === 'error' || city.anomaly.status === 'error'
}

// --------------------------------------------------------------------------------------------- metrics

export interface CityMetrics {
  /** True when this response is available; null metrics below then mean "not loaded", not zero. */
  hasHeatwave: boolean
  hasAnomaly: boolean
  totalEvents: number | null
  totalHeatwaveDays: number | null
  /** Null both when unavailable and when there were no events (see `noEvents`). */
  meanDurationDays: number | null
  maxDurationDays: number | null
  noEvents: boolean
  /** Mean heatwave days per complete year; null when no year is complete. */
  avgAnnualHeatwaveDays: number | null
  completeYears: number | null
  yearsInWindow: number | null
  /** Mean of annual mean daily maximum over complete years (not the absolute annual maximum). */
  avgAnnualMeanDailyMaxC: number | null
  meanAnomalyC: number | null
  anomalyCompleteYears: number | null
  heatwaveDayTrendPerDecade: number | null
  heatwaveDayTrendClass: TrendClassification | null
  heatwaveDayTrendYears: number | null
  analysisCoverage: number | null
  missingDayCount: number | null
  thresholdC: number | null
  warnings: string[]
}

export function buildCityMetrics(city: CityResult): CityMetrics {
  const h = city.heatwave.status === 'success' ? city.heatwave.data : null
  const a = city.anomaly.status === 'success' ? city.anomaly.data : null
  const trend = h?.trend?.metrics.find((m) => m.metric === 'total_heatwave_days') ?? null
  const events = h?.summary.total_events ?? null
  return {
    hasHeatwave: h !== null,
    hasAnomaly: a !== null,
    totalEvents: events,
    totalHeatwaveDays: h?.summary.total_heatwave_days ?? null,
    meanDurationDays: h?.summary.mean_duration_days ?? null,
    maxDurationDays: h?.summary.max_duration_days ?? null,
    noEvents: events === 0,
    avgAnnualHeatwaveDays: h?.summary.heatwave_days_per_complete_year ?? null,
    completeYears: h?.summary.complete_years ?? null,
    yearsInWindow: h?.annual.length ?? null,
    avgAnnualMeanDailyMaxC: a?.summary.mean_annual_daily_max_c ?? null,
    meanAnomalyC: a?.summary.mean_anomaly_c ?? null,
    anomalyCompleteYears: a?.summary.complete_years ?? null,
    heatwaveDayTrendPerDecade: trend?.slope_per_decade ?? null,
    heatwaveDayTrendClass: trend?.classification ?? null,
    heatwaveDayTrendYears: trend?.n_observations ?? null,
    analysisCoverage: h?.data_quality.analysis_coverage ?? a?.data_quality.analysis_coverage ?? null,
    missingDayCount: a?.data_quality.missing_day_count ?? h?.data_quality.missing_dates.length ?? null,
    thresholdC: h?.baseline.threshold_c ?? null,
    warnings: [...new Set([...(h?.data_quality.warnings ?? []), ...(a?.data_quality.warnings ?? [])])],
  }
}

// --------------------------------------------------------------------------------------------- chart series

export type ComparisonChartKey = 'heatwave_days' | 'mean_daily_max' | 'anomaly'

export interface ComparisonChartConfig {
  key: ComparisonChartKey
  title: string
  unit: string
  digits: number
  help: string
}

export const COMPARISON_CHARTS: readonly ComparisonChartConfig[] = [
  {
    key: 'heatwave_days',
    title: 'Heatwave days per year',
    unit: 'days',
    digits: 0,
    help: 'Days inside heatwave events that started in each complete calendar year. A complete year with no events is a real zero and is drawn at 0.',
  },
  {
    key: 'mean_daily_max',
    title: 'Annual mean daily maximum temperature',
    unit: '°C',
    digits: 1,
    help: 'The average of each complete year’s daily maximum temperatures. This is not the hottest day of the year and not the mean air temperature.',
  },
  {
    key: 'anomaly',
    title: 'Temperature anomaly',
    unit: '°C vs baseline',
    digits: 2,
    help: 'Annual mean daily maximum minus the same location’s 1991–2020 mean daily maximum. Positive means warmer than its own baseline.',
  },
]

/** Why a point is empty. A real value of zero is never "empty". */
export type PointState = 'value' | 'incomplete' | 'no_data' | 'unavailable'

export interface ComparisonRow {
  year: number
  /** Keyed `s0`..`s3` (the location slot); null leaves a gap in the line. */
  values: Record<string, number | null>
  states: Record<string, PointState>
}

export interface ComparisonSeries {
  location: ComparisonLocation
  dataKey: string
  /** Complete years that have a plotted value. */
  plotted: number
  /** Years in the window that are not plotted (incomplete, no data) or all years if the data is unavailable. */
  omitted: number
  available: boolean
}

export interface ComparisonChartData {
  rows: ComparisonRow[]
  series: ComparisonSeries[]
}

export const slotKey = (slot: number) => `s${slot}`

export function buildComparisonChart(cities: readonly CityResult[], chart: ComparisonChartKey): ComparisonChartData {
  const years = new Set<number>()
  for (const city of cities) {
    if (city.heatwave.status === 'success') city.heatwave.data.annual.forEach((r) => years.add(r.year))
    if (city.anomaly.status === 'success') city.anomaly.data.annual.forEach((r) => years.add(r.year))
  }
  const sorted = [...years].sort((x, y) => x - y)

  const rows: ComparisonRow[] = sorted.map((year) => ({ year, values: {}, states: {} }))
  const series: ComparisonSeries[] = []

  for (const city of cities) {
    const key = slotKey(city.location.slot)
    const source = chart === 'heatwave_days' ? city.heatwave : city.anomaly
    let plotted = 0
    for (const row of rows) {
      let value: number | null = null
      let state: PointState = 'unavailable'
      if (source.status === 'success') {
        if (chart === 'heatwave_days') {
          const annual = (source.data as HeatwaveAnalysis).annual.find((r) => r.year === row.year)
          if (!annual || annual.days_observed === 0) state = 'no_data'
          else if (!annual.is_complete) state = 'incomplete'
          else {
            value = annual.total_heatwave_days // a complete year with zero heatwave days is a real 0
            state = 'value'
          }
        } else {
          const annual = (source.data as TemperatureAnomalies).annual.find((r) => r.year === row.year)
          if (!annual || annual.status === 'no_data') state = 'no_data'
          else if (annual.status !== 'complete') state = 'incomplete'
          else {
            value = chart === 'anomaly' ? annual.anomaly_c : annual.annual_mean_daily_max_c
            state = value === null ? 'no_data' : 'value'
          }
        }
      }
      row.values[key] = value
      row.states[key] = state
      if (value !== null) plotted += 1
    }
    series.push({
      location: city.location,
      dataKey: key,
      plotted,
      omitted: sorted.length - plotted,
      available: source.status === 'success',
    })
  }
  return { rows, series }
}

export const POINT_STATE_LABEL: Record<PointState, string> = {
  value: '',
  incomplete: 'Incomplete year, not plotted',
  no_data: 'No valid observations',
  unavailable: 'Data not loaded',
}
