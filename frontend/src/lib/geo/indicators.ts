import { buildCityMetrics, type CityResult } from '@/lib/comparison'
import { formatNumber, formatSigned } from '@/lib/format'

/**
 * Map indicators. Every value is read from an existing /api/heatwaves or /api/temperature-anomalies response for
 * ONE observation location (via buildCityMetrics); nothing is averaged across places and nothing is computed
 * here. See docs/geospatial_architecture.md, section 5.
 */

export type IndicatorId =
  | 'events'
  | 'heatwave_days'
  | 'mean_duration'
  | 'max_duration'
  | 'anomaly'
  | 'heatwave_trend'
  | 'temperature_trend'

export interface Indicator {
  id: IndicatorId
  label: string
  unit: string
  digits: number
  scale: 'sequential' | 'diverging'
  source: 'heatwave' | 'anomaly'
  available: boolean
  unavailableReason?: string
  description: string
}

export const INDICATORS: readonly Indicator[] = [
  {
    id: 'heatwave_days',
    label: 'Heatwave days per year',
    unit: 'days/yr',
    digits: 1,
    scale: 'sequential',
    source: 'heatwave',
    available: true,
    description: 'Mean number of heatwave days per complete calendar year in the period.',
  },
  {
    id: 'events',
    label: 'Heatwave events',
    unit: 'events',
    digits: 0,
    scale: 'sequential',
    source: 'heatwave',
    available: true,
    description: 'Heatwave events that started in the period (3+ consecutive days above the local 95th percentile).',
  },
  {
    id: 'mean_duration',
    label: 'Average event duration',
    unit: 'days',
    digits: 1,
    scale: 'sequential',
    source: 'heatwave',
    available: true,
    description: 'Mean length of the heatwave events in the period.',
  },
  {
    id: 'max_duration',
    label: 'Longest event',
    unit: 'days',
    digits: 0,
    scale: 'sequential',
    source: 'heatwave',
    available: true,
    description: 'Length of the longest heatwave event in the period.',
  },
  {
    id: 'anomaly',
    label: 'Temperature anomaly',
    unit: '°C',
    digits: 2,
    scale: 'diverging',
    source: 'anomaly',
    available: true,
    description: 'Mean over complete years of the annual mean daily maximum minus the location’s own 1991–2020 mean.',
  },
  {
    id: 'heatwave_trend',
    label: 'Heatwave-day trend',
    unit: 'days/decade',
    digits: 1,
    scale: 'diverging',
    source: 'heatwave',
    available: true,
    description: 'Least-squares slope of heatwave days per complete year, per decade (with its significance class).',
  },
  {
    id: 'temperature_trend',
    label: 'Temperature trend',
    unit: '°C/decade',
    digits: 2,
    scale: 'diverging',
    source: 'anomaly',
    available: false,
    unavailableReason: 'Not computed by the current API. It will be added as a backend analysis rather than estimated in the browser.',
    description: 'Slope of the annual anomalies.',
  },
]

export const indicatorById = (id: IndicatorId): Indicator => INDICATORS.find((i) => i.id === id)!

export type IndicatorValue =
  | { kind: 'value'; value: number; note?: string }
  | { kind: 'empty'; reason: string }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_analyzed' }

export function indicatorValue(id: IndicatorId, city: CityResult | undefined): IndicatorValue {
  const indicator = indicatorById(id)
  if (!indicator.available) return { kind: 'empty', reason: indicator.unavailableReason ?? 'Not available.' }
  if (!city) return { kind: 'not_analyzed' }
  const part = indicator.source === 'heatwave' ? city.heatwave : city.anomaly
  if (part.status === 'loading') return { kind: 'loading' }
  if (part.status === 'error') return { kind: 'error' }
  if (part.status === 'idle') return { kind: 'not_analyzed' }
  const m = buildCityMetrics(city)
  const value = (v: number | null, reason: string, note?: string): IndicatorValue =>
    v === null ? { kind: 'empty', reason } : { kind: 'value', value: v, note }
  switch (id) {
    case 'events':
      return value(m.totalEvents, 'No result.')
    case 'heatwave_days':
      return value(m.avgAnnualHeatwaveDays, 'No complete calendar year in the period.')
    case 'mean_duration':
      return value(m.noEvents ? null : m.meanDurationDays, m.noEvents ? 'No heatwave events in the period.' : 'No result.')
    case 'max_duration':
      return value(m.noEvents ? null : m.maxDurationDays, m.noEvents ? 'No heatwave events in the period.' : 'No result.')
    case 'anomaly':
      return value(m.meanAnomalyC, 'No complete calendar year in the period.')
    case 'heatwave_trend':
      return m.heatwaveDayTrendClass === 'insufficient_data' || m.heatwaveDayTrendPerDecade === null
        ? { kind: 'empty', reason: 'Too few complete years for a trend (3 needed).' }
        : { kind: 'value', value: m.heatwaveDayTrendPerDecade, note: m.heatwaveDayTrendClass ?? undefined }
    default:
      return { kind: 'empty', reason: 'Not available.' }
  }
}

export function formatIndicator(indicator: Indicator, value: number): string {
  return indicator.scale === 'diverging' ? formatSigned(value, indicator.digits) : formatNumber(value, indicator.digits)
}

// --------------------------------------------------------------------------------------------- colour scales

export interface ScaleClass {
  color: string
  label: string
}

export interface ColorScale {
  classes: ScaleClass[]
  colorFor: (value: number) => string
}

const SEQUENTIAL = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']
const DIVERGING = ['var(--div-cool-2)', 'var(--div-cool-1)', 'var(--div-mid)', 'var(--div-heat-1)', 'var(--div-heat-2)']

/** Smallest 1/2/2.5/5 x 10^k that is >= value. */
export function niceCeil(value: number): number {
  if (value <= 0) return 0
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value - 1e-12) return step * power
  return 10 * power
}

/**
 * Five classes over the values of the locations analysed so far (the legend says so). Sequential: equal steps
 * from 0. Diverging: symmetric around 0 with a neutral middle class, so "no change" is never coloured as heat.
 */
export function scaleFor(indicator: Indicator, values: readonly number[]): ColorScale | null {
  if (values.length === 0) return null
  const fmt = (v: number) => formatIndicator(indicator, v)
  if (indicator.scale === 'sequential') {
    const max = Math.max(...values)
    const integer = indicator.digits === 0
    const step = max === 0 ? 1 : integer ? Math.max(1, Math.ceil(max / 5)) : niceCeil(max / 5)
    const classes = SEQUENTIAL.map((color, i) => {
      const lo = i * step
      const hi = (i + 1) * step
      const label = i === SEQUENTIAL.length - 1 ? `${fmt(lo)} or more` : integer ? (hi - 1 > lo ? `${fmt(lo)}–${fmt(hi - 1)}` : fmt(lo)) : `${fmt(lo)} to < ${fmt(hi)}`
      return { color, label }
    })
    return { classes, colorFor: (v) => SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.floor(v / step + 1e-9))] }
  }
  const m = niceCeil(Math.max(...values.map(Math.abs))) || 1
  const edges = [-0.6 * m, -0.2 * m, 0.2 * m, 0.6 * m]
  const f = (v: number) => formatSigned(v, indicator.digits)
  const classes = [
    { color: DIVERGING[0], label: `below ${f(edges[0])}` },
    { color: DIVERGING[1], label: `${f(edges[0])} to ${f(edges[1])}` },
    { color: DIVERGING[2], label: `${f(edges[1])} to ${f(edges[2])} (near zero)` },
    { color: DIVERGING[3], label: `${f(edges[2])} to ${f(edges[3])}` },
    { color: DIVERGING[4], label: `above ${f(edges[3])}` },
  ]
  const colorFor = (v: number) => {
    if (v < edges[0]) return DIVERGING[0]
    if (v < edges[1]) return DIVERGING[1]
    if (v <= edges[2]) return DIVERGING[2]
    if (v <= edges[3]) return DIVERGING[3]
    return DIVERGING[4]
  }
  return { classes, colorFor }
}
