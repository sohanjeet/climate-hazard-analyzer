import { describe, expect, it } from 'vitest'
import { makeAnalysis } from '@/test/fixtures'
import { CHART_METRICS, buildChartSeries, describeRollingStatus } from './chartData'

const metric = (key: string) => CHART_METRICS.find((m) => m.key === key)!

describe('buildChartSeries', () => {
  it('splits complete and incomplete years into separate bar series', () => {
    const series = buildChartSeries(makeAnalysis({ incompleteYears: [2024] }), metric('heatwave_frequency'))
    const row2024 = series.rows.find((r) => r.year === 2024)!
    expect(row2024.status).toBe('incomplete')
    expect(row2024.completeValue).toBeNull()
    expect(row2024.incompleteValue).toBe(4)
    expect(series.rows.find((r) => r.year === 2023)).toMatchObject({ status: 'complete', completeValue: 2, incompleteValue: null })
    expect(series.hasIncomplete).toBe(true)
  })

  it('leaves event-derived metrics undefined (not zero) in years without events', () => {
    const series = buildChartSeries(makeAnalysis(), metric('mean_duration_days'))
    const row = series.rows.find((r) => r.year === 2018)!
    expect(row.status).toBe('no_events')
    expect(row.value).toBeNull()
    expect(row.completeValue).toBeNull()
    expect(series.hasNoEvents).toBe(true)
  })

  it('shows zero events as a real zero for count metrics', () => {
    const row = buildChartSeries(makeAnalysis(), metric('heatwave_frequency')).rows.find((r) => r.year === 2018)!
    expect(row.status).toBe('complete')
    expect(row.value).toBe(0)
  })

  it('treats a year with no observations as missing, not as zero events', () => {
    const analysis = makeAnalysis({ unobservedYears: [2020] })
    for (const key of ['heatwave_frequency', 'total_heatwave_days', 'mean_duration_days', 'max_intensity_c']) {
      const row = buildChartSeries(analysis, metric(key)).rows.find((r) => r.year === 2020)!
      expect(row.status).toBe('no_data')
      expect(row.value).toBeNull()
      expect(row.completeValue).toBeNull()
      expect(row.incompleteValue).toBeNull()
      expect(row.daysObserved).toBe(0)
    }
  })

  it('carries rolling means only where the API provided them and never bridges gaps', () => {
    const series = buildChartSeries(makeAnalysis({ incompleteYears: [2021] }), metric('heatwave_frequency'))
    const byYear = Object.fromEntries(series.rows.map((r) => [r.year, r]))
    expect(byYear[2018].rolling).toBeNull() // not enough history
    expect(byYear[2018].rollingStatus).toBe('insufficient_history')
    expect(byYear[2020].rolling).toBeCloseTo((0 + 1 + 2) / 3)
    expect(byYear[2021].rollingStatus).toBe('year_unavailable')
    expect(byYear[2022].rolling).toBeNull()
    expect(byYear[2022].rollingStatus).toBe('gap_in_window')
    expect(byYear[2022].gapYears).toEqual([2021])
    expect(series.hasRolling).toBe(true)
    expect(series.rollingWindow).toBe(3)
  })

  it('reports no rolling line when the trend block is absent', () => {
    const series = buildChartSeries(makeAnalysis({ trend: 'none' }), metric('heatwave_frequency'))
    expect(series.hasRolling).toBe(false)
    expect(series.rollingWindow).toBeNull()
    expect(series.rows.every((r) => r.rolling === null && r.rollingStatus === null)).toBe(true)
  })

  it('has no rolling line when every year is incomplete', () => {
    const series = buildChartSeries(
      makeAnalysis({ incompleteYears: [2018, 2019, 2020, 2021, 2022, 2023, 2024] }),
      metric('heatwave_frequency'),
    )
    expect(series.hasRolling).toBe(false)
    expect(series.hasIncomplete).toBe(true)
  })
})

describe('describeRollingStatus', () => {
  it('explains each reason', () => {
    expect(describeRollingStatus('ok', [], 5)).toBe('5-year mean')
    expect(describeRollingStatus('gap_in_window', [2021, 2022], 5)).toContain('2021, 2022')
    expect(describeRollingStatus('insufficient_history', [], 5)).toMatch(/before the first/)
    expect(describeRollingStatus('year_unavailable', [], 5)).toMatch(/excluded or has no value/)
  })
})
