import { describe, expect, it } from 'vitest'
import { CHART_METRICS, buildChartSeries } from '@/lib/chartData'
import sample from '@/test/fixtures/live-sample.json'
import { parseHeatwaveAnalysis } from './parse'

/**
 * Contract check against a response captured from the running FastAPI backend (GET /api/heatwaves, 2019-2025,
 * rolling_window_years=3). If the backend schema drifts, re-capture the file and this test shows what broke.
 */
describe('captured backend response', () => {
  const parsed = parseHeatwaveAnalysis(sample)

  it('parses with every section the dashboard reads', () => {
    expect(parsed.analysis_type).toBe('heatwave')
    expect(parsed.method.method_version).toBe('heatwave-v1')
    expect(parsed.baseline.start_year).toBe(1991)
    expect(parsed.annual.map((a) => a.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025])
    expect(parsed.trend?.metrics.map((m) => m.metric)).toEqual([
      'heatwave_frequency',
      'total_heatwave_days',
      'mean_duration_days',
      'max_intensity_c',
      'mean_intensity_c',
    ])
    expect(parsed.trend?.method.rolling_window_years).toBe(3)
  })

  it('is internally consistent: summary equals the event list, annual rows equal summary', () => {
    expect(parsed.summary.total_events).toBe(parsed.events.length)
    expect(parsed.annual.reduce((sum, a) => sum + a.heatwave_count, 0)).toBe(parsed.summary.total_events)
    expect(parsed.annual.reduce((sum, a) => sum + a.total_heatwave_days, 0)).toBe(parsed.summary.total_heatwave_days)
  })

  it('builds a chart series for every chart with rolling means from the API', () => {
    for (const metric of CHART_METRICS) {
      const series = buildChartSeries(parsed, metric)
      expect(series.rows).toHaveLength(7)
      expect(series.hasRolling).toBe(true)
      expect(series.rollingWindow).toBe(3)
    }
  })
})
