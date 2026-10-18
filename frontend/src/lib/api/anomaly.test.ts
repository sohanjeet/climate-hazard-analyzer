import { describe, expect, it, vi } from 'vitest'
import { ANOMALY_STATUS_LABEL, buildAnomalyChart, describeAnomalySign } from '@/lib/anomalyData'
import { makeAnomalies } from '@/test/fixtures'
import { buildAnomalyUrl, fetchTemperatureAnomalies } from './client'
import { ApiError } from './errors'
import { parseTemperatureAnomalies } from './parse'

const baseUrl = 'http://api.test'
const request = { latitude: 28.6139, longitude: 77.209, startDate: '2018-01-01', endDate: '2024-12-31' }

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

describe('buildAnomalyUrl', () => {
  it('uses the endpoint and backend parameter names', () => {
    const url = new URL(buildAnomalyUrl(request, baseUrl))
    expect(url.origin + url.pathname).toBe('http://api.test/api/temperature-anomalies')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '28.6139',
      longitude: '77.209',
      start_date: '2018-01-01',
      end_date: '2024-12-31',
    })
  })

  it('adds explicit baseline years only when given', () => {
    const url = new URL(buildAnomalyUrl({ ...request, baselineStartYear: 1981, baselineEndYear: 2010 }, baseUrl))
    expect(url.searchParams.get('baseline_start_year')).toBe('1981')
    expect(url.searchParams.get('baseline_end_year')).toBe('2010')
  })
})

describe('fetchTemperatureAnomalies', () => {
  it('requests JSON and returns the validated body', async () => {
    const fetchImpl = vi.fn(async () => json(makeAnomalies()))
    const result = await fetchTemperatureAnomalies(request, { baseUrl, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.baseline.start_year).toBe(1991)
    expect(result.annual).toHaveLength(7)
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('/api/temperature-anomalies?')
  })

  it('maps HTTP errors the same way as the heatwave endpoint', async () => {
    const rate = fetchTemperatureAnomalies(request, {
      baseUrl,
      fetchImpl: (async () =>
        json({ detail: { error: 'Rate limit exceeded; retry later' } }, { status: 429, headers: { 'Retry-After': '9' } })) as unknown as typeof fetch,
    })
    await expect(rate).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 9 })

    const baseline = fetchTemperatureAnomalies(request, {
      baseUrl,
      fetchImpl: (async () => json({ detail: { error: 'baseline period has insufficient valid observations' } }, { status: 422 })) as unknown as typeof fetch,
    })
    await expect(baseline).rejects.toMatchObject({ kind: 'validation', message: 'baseline period has insufficient valid observations' })
  })

  it('rejects a malformed 200 instead of rendering partial numbers', async () => {
    const broken = { ...makeAnomalies(), annual: [{ year: 2020 }] }
    const failure = fetchTemperatureAnomalies(request, { baseUrl, fetchImpl: (async () => json(broken)) as unknown as typeof fetch })
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('parseTemperatureAnomalies', () => {
  it('keeps null means and anomalies as null, never zero', () => {
    const parsed = parseTemperatureAnomalies(makeAnomalies({ unobservedYears: [2020], lowCoverageYears: [2021] }))
    const noData = parsed.annual.find((a) => a.year === 2020)!
    const low = parsed.annual.find((a) => a.year === 2021)!
    expect(noData).toMatchObject({ annual_mean_daily_max_c: null, anomaly_c: null, status: 'no_data' })
    expect(low.annual_mean_daily_max_c).not.toBeNull()
    expect(low.anomaly_c).toBeNull()
  })

  it.each([
    ['unknown year status', (b: any) => { b.annual[0].status = 'nope' }, /annual\[0\]\.status/],
    ['string temperature', (b: any) => { b.baseline.mean_daily_max_c = '30' }, /baseline\.mean_daily_max_c/],
    ['missing summary', (b: any) => { delete b.summary }, /summary/],
    ['NaN anomaly', (b: any) => { b.annual[1].anomaly_c = Number.NaN }, /annual\[1\]\.anomaly_c/],
  ])('rejects %s', (_name, mutate, path) => {
    const body = JSON.parse(JSON.stringify(makeAnomalies()))
    mutate(body)
    expect(() => parseTemperatureAnomalies(body)).toThrow(path)
  })
})

describe('buildAnomalyChart', () => {
  it('splits anomalies into positive and negative series and keeps a real zero', () => {
    const chart = buildAnomalyChart(makeAnomalies())
    const byYear = Object.fromEntries(chart.rows.map((r) => [r.year, r]))
    expect(byYear[2018]).toMatchObject({ anomaly: 0.4, positive: 0.4, negative: null })
    expect(byYear[2019]).toMatchObject({ anomaly: -0.3, positive: null, negative: -0.3 })
    expect(byYear[2021]).toMatchObject({ anomaly: 0, positive: null, negative: null }) // zero: a point, no bar
    expect(chart.baselineMean).toBe(30.8)
    expect(chart.baselineLabel).toBe('1991–2020')
    expect(chart.hasAnomaly).toBe(true)
    expect(chart.incompleteYears).toBe(0)
  })

  it('does not plot incomplete years and still reports their mean for the table', () => {
    const chart = buildAnomalyChart(makeAnomalies({ lowCoverageYears: [2019], partialYears: [2024], unobservedYears: [2020] }))
    const byYear = Object.fromEntries(chart.rows.map((r) => [r.year, r]))
    expect(byYear[2019]).toMatchObject({ status: 'low_coverage', anomaly: null, meanDailyMax: null, reportedMean: 30.5 })
    expect(byYear[2024]).toMatchObject({ status: 'partial_year', anomaly: null, meanDailyMax: null })
    expect(byYear[2020]).toMatchObject({ status: 'no_data', reportedMean: null })
    expect(chart.incompleteYears).toBe(3)
  })

  it('has no anomaly at all when every year is incomplete', () => {
    const chart = buildAnomalyChart(makeAnomalies({ lowCoverageYears: [2018, 2019, 2020, 2021, 2022, 2023, 2024] }))
    expect(chart.hasAnomaly).toBe(false)
  })

  it('describes the sign in words', () => {
    expect(describeAnomalySign(1.6)).toBe('warmer than the baseline')
    expect(describeAnomalySign(-0.1)).toBe('cooler than the baseline')
    expect(describeAnomalySign(0)).toBe('equal to the baseline')
    expect(describeAnomalySign(null)).toBe('not available')
    expect(Object.keys(ANOMALY_STATUS_LABEL)).toHaveLength(4)
  })
})
