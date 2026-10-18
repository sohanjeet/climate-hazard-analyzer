import { describe, expect, it } from 'vitest'
import { makeAnalysis } from '@/test/fixtures'
import { ApiError } from './errors'
import { parseHeatwaveAnalysis } from './parse'

describe('parseHeatwaveAnalysis', () => {
  it('accepts a complete response and returns the same values', () => {
    const body = makeAnalysis()
    const parsed = parseHeatwaveAnalysis(JSON.parse(JSON.stringify(body)))
    expect(parsed.summary.total_events).toBe(body.summary.total_events)
    expect(parsed.annual).toHaveLength(7)
    expect(parsed.trend?.metrics).toHaveLength(5)
    expect(parsed.baseline.threshold_c).toBe(39.6)
  })

  it('keeps null metrics null rather than turning them into zero', () => {
    const parsed = parseHeatwaveAnalysis(JSON.parse(JSON.stringify(makeAnalysis())))
    const noEvents = parsed.annual.find((a) => a.year === 2018)
    expect(noEvents?.mean_duration_days).toBeNull()
    expect(noEvents?.max_intensity_c).toBeNull()
  })

  it('treats a missing or null trend as null (the field is optional in the backend schema)', () => {
    const body = JSON.parse(JSON.stringify(makeAnalysis())) as Record<string, unknown>
    delete body.trend
    expect(parseHeatwaveAnalysis(body).trend).toBeNull()
    body.trend = null
    expect(parseHeatwaveAnalysis(body).trend).toBeNull()
  })

  it('ignores unknown extra fields, as the backend schemas do', () => {
    const body = { ...JSON.parse(JSON.stringify(makeAnalysis())), future_field: { a: 1 } }
    expect(() => parseHeatwaveAnalysis(body)).not.toThrow()
  })

  it('throws invalid_response naming the offending path', () => {
    const body = JSON.parse(JSON.stringify(makeAnalysis()))
    body.summary.total_events = 'many'
    try {
      parseHeatwaveAnalysis(body)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).kind).toBe('invalid_response')
      expect((error as ApiError).message).toContain('summary.total_events')
    }
  })

  it('rejects a missing required section, an unknown enum value and a non-object body', () => {
    const missing = JSON.parse(JSON.stringify(makeAnalysis()))
    delete missing.baseline
    expect(() => parseHeatwaveAnalysis(missing)).toThrow(/baseline/)

    const badEnum = JSON.parse(JSON.stringify(makeAnalysis()))
    badEnum.trend.metrics[0].classification = 'surging'
    expect(() => parseHeatwaveAnalysis(badEnum)).toThrow(/classification/)

    expect(() => parseHeatwaveAnalysis([])).toThrow(ApiError)
    expect(() => parseHeatwaveAnalysis('nope')).toThrow(ApiError)
  })
})
