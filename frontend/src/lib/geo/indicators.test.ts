import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import type { CityResult } from '@/lib/comparison'
import { INDICATORS, indicatorById, indicatorValue, niceCeil, scaleFor } from '@/lib/geo/indicators'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'

const location = { id: '26.9124,75.7873', name: 'Jaipur', latitude: 26.9124, longitude: 75.7873, slot: 0 }

function city(overrides: Partial<CityResult> = {}): CityResult {
  return { location, heatwave: { status: 'success', data: makeAnalysis() }, anomaly: { status: 'success', data: makeAnomalies() }, ...overrides }
}

describe('indicator values', () => {
  it('reads every value from the API response for one location', () => {
    const analysis = makeAnalysis()
    const c = city()
    expect(indicatorValue('events', c)).toEqual({ kind: 'value', value: analysis.summary.total_events })
    expect(indicatorValue('heatwave_days', c)).toEqual({ kind: 'value', value: analysis.summary.heatwave_days_per_complete_year })
    expect(indicatorValue('max_duration', c)).toEqual({ kind: 'value', value: analysis.summary.max_duration_days })
    expect(indicatorValue('anomaly', c)).toEqual({ kind: 'value', value: makeAnomalies().summary.mean_anomaly_c })
  })

  it('distinguishes not analysed, loading and failed from a value', () => {
    expect(indicatorValue('events', undefined)).toEqual({ kind: 'not_analyzed' })
    expect(indicatorValue('events', city({ heatwave: { status: 'loading' } }))).toEqual({ kind: 'loading' })
    expect(indicatorValue('events', city({ heatwave: { status: 'error', error: new ApiError('upstream', 'x') } }))).toEqual({ kind: 'error' })
    // The anomaly indicator does not depend on the heatwave request, and vice versa.
    expect(indicatorValue('anomaly', city({ heatwave: { status: 'loading' } })).kind).toBe('value')
  })

  it('never turns "no events" into a zero duration, but a zero count is a real zero', () => {
    const none = city({ heatwave: { status: 'success', data: makeAnalysis({ noEvents: true }) } })
    expect(indicatorValue('events', none)).toEqual({ kind: 'value', value: 0 })
    expect(indicatorValue('mean_duration', none)).toEqual({ kind: 'empty', reason: 'No heatwave events in the period.' })
    expect(indicatorValue('max_duration', none)).toEqual({ kind: 'empty', reason: 'No heatwave events in the period.' })
  })

  it('reports a trend only when there are enough complete years', () => {
    expect(indicatorValue('heatwave_trend', city()).kind).toBe('value')
    const few = city({ heatwave: { status: 'success', data: makeAnalysis({ trend: 'insufficient' }) } })
    expect(indicatorValue('heatwave_trend', few)).toEqual({ kind: 'empty', reason: 'Too few complete years for a trend (3 needed).' })
  })

  it('lists the temperature trend as unavailable instead of estimating it', () => {
    const def = indicatorById('temperature_trend')
    expect(def.available).toBe(false)
    expect(indicatorValue('temperature_trend', city())).toMatchObject({ kind: 'empty' })
    expect(INDICATORS.filter((i) => i.available).map((i) => i.id)).toEqual(['heatwave_days', 'events', 'mean_duration', 'max_duration', 'anomaly', 'heatwave_trend'])
  })
})

describe('colour scales', () => {
  it('rounds class widths to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect([0.3, 1, 1.1, 2.2, 3, 7, 12].map(niceCeil)).toEqual([0.5, 1, 2, 2.5, 5, 10, 20])
  })

  it('splits sequential indicators into five equal classes from zero', () => {
    const scale = scaleFor(indicatorById('events'), [0, 3, 12])!
    expect(scale.classes.map((c) => c.label)).toEqual(['0–2', '3–5', '6–8', '9–11', '12 or more'])
    expect([0, 2, 3, 11, 12, 40].map(scale.colorFor)).toEqual(['var(--seq-1)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-5)'])
  })

  it('centres diverging indicators on a neutral class, never coloured as heat', () => {
    const scale = scaleFor(indicatorById('anomaly'), [-0.4, 0.05, 1.7])!
    expect(scale.classes).toHaveLength(5)
    expect(scale.colorFor(0)).toBe('var(--div-mid)')
    expect(scale.colorFor(0.3)).toBe('var(--div-mid)') // within ±20% of the 2 °C half-range
    expect(scale.colorFor(1.7)).toBe('var(--div-heat-2)')
    expect(scale.colorFor(-1.5)).toBe('var(--div-cool-2)')
  })

  it('has no scale until something is analysed', () => {
    expect(scaleFor(indicatorById('events'), [])).toBeNull()
  })
})
