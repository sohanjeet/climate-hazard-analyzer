import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import {
  MAX_LOCATIONS,
  PRESET_LOCATIONS,
  addLocation,
  buildCityMetrics,
  buildComparisonChart,
  locationId,
  removeLocation,
  validateCustomLocation,
  type CityResult,
  type ComparisonLocation,
} from '@/lib/comparison'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'

function listOf(...names: (typeof PRESET_LOCATIONS)[number]['name'][]): ComparisonLocation[] {
  let list: ComparisonLocation[] = []
  for (const name of names) {
    const preset = PRESET_LOCATIONS.find((p) => p.name === name)!
    const result = addLocation(list, preset)
    if (!result.ok) throw new Error(result.error)
    list = result.locations
  }
  return list
}

function city(location: ComparisonLocation, heatwave = makeAnalysis(), anomaly = makeAnomalies()): CityResult {
  return { location, heatwave: { status: 'success', data: heatwave }, anomaly: { status: 'success', data: anomaly } }
}

describe('presets', () => {
  it('are the four documented cities with exact coordinates', () => {
    expect(PRESET_LOCATIONS.map((p) => [p.name, p.latitude, p.longitude])).toEqual([
      ['Delhi', 28.6139, 77.209],
      ['Mumbai', 19.076, 72.8777],
      ['Bengaluru', 12.9716, 77.5946],
      ['Chennai', 13.0827, 80.2707],
    ])
  })
})

describe('addLocation / removeLocation', () => {
  it('adds up to four locations and refuses a fifth', () => {
    const four = listOf('Delhi', 'Mumbai', 'Bengaluru', 'Chennai')
    expect(four).toHaveLength(MAX_LOCATIONS)
    const result = addLocation(four, { name: 'Pune', latitude: 18.5204, longitude: 73.8567 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at most 4 locations/)
  })

  it('rejects duplicate coordinates, also when typed with different precision', () => {
    const list = listOf('Delhi')
    const same = addLocation(list, { name: 'Dilli', latitude: 28.61390001, longitude: 77.20899999 })
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.error).toMatch(/Delhi already uses these coordinates/)
    expect(addLocation(list, { name: 'Near', latitude: 28.6141, longitude: 77.209 }).ok).toBe(true)
  })

  it('keeps each location in its colour slot when another is removed, and reuses the freed slot', () => {
    const list = listOf('Delhi', 'Mumbai', 'Bengaluru')
    expect(list.map((l) => l.slot)).toEqual([0, 1, 2])
    const without = removeLocation(list, locationId(19.076, 72.8777))
    expect(without.map((l) => [l.name, l.slot])).toEqual([['Delhi', 0], ['Bengaluru', 2]])
    const added = addLocation(without, PRESET_LOCATIONS[3])
    expect(added.ok && added.locations.map((l) => [l.name, l.slot])).toEqual([['Delhi', 0], ['Bengaluru', 2], ['Chennai', 1]])
  })
})

describe('validateCustomLocation', () => {
  it('accepts valid coordinates and names a blank-name location after its coordinates', () => {
    const { errors, candidate } = validateCustomLocation({ name: '  ', latitude: '51.5074', longitude: '-0.1278' })
    expect(errors).toEqual({})
    expect(candidate).toEqual({ name: 'Custom (51.507°N, 0.128°W)', latitude: 51.5074, longitude: -0.1278 })
  })

  it.each([
    [{ latitude: '', longitude: '10' }, 'latitude', /Enter a latitude/],
    [{ latitude: 'abc', longitude: '10' }, 'latitude', /must be a number/],
    [{ latitude: '90.5', longitude: '10' }, 'latitude', /between -90 and 90/],
    [{ latitude: '10', longitude: '-181' }, 'longitude', /between -180 and 180/],
    [{ latitude: '10', longitude: 'NaN' }, 'longitude', /must be a number/],
  ])('rejects %j', (input, field, message) => {
    const { errors, candidate } = validateCustomLocation({ name: '', ...input })
    expect(candidate).toBeNull()
    expect(errors[field as 'latitude' | 'longitude']).toMatch(message)
  })

  it('accepts the coordinate limits and rejects a very long name', () => {
    expect(validateCustomLocation({ name: 'Pole', latitude: '-90', longitude: '180' }).candidate).not.toBeNull()
    expect(validateCustomLocation({ name: 'x'.repeat(41), latitude: '1', longitude: '1' }).errors.name).toMatch(/at most 40/)
  })
})

describe('buildCityMetrics', () => {
  const [delhi] = listOf('Delhi')

  it('reads every metric from the API responses without recomputing', () => {
    const heat = makeAnalysis()
    const metrics = buildCityMetrics(city(delhi, heat))
    expect(metrics.totalEvents).toBe(heat.summary.total_events)
    expect(metrics.totalHeatwaveDays).toBe(heat.summary.total_heatwave_days)
    expect(metrics.avgAnnualHeatwaveDays).toBe(heat.summary.heatwave_days_per_complete_year)
    expect(metrics.completeYears).toBe(7)
    expect(metrics.heatwaveDayTrendPerDecade).toBe(1.2)
    expect(metrics.heatwaveDayTrendClass).toBe('increasing')
    expect(metrics.avgAnnualMeanDailyMaxC).toBe(makeAnomalies().summary.mean_annual_daily_max_c)
    expect(metrics.noEvents).toBe(false)
  })

  it('tells "no events" (a real zero) apart from "not loaded"', () => {
    const zero = buildCityMetrics(city(delhi, makeAnalysis({ noEvents: true })))
    expect(zero.hasHeatwave).toBe(true)
    expect(zero.totalEvents).toBe(0)
    expect(zero.totalHeatwaveDays).toBe(0)
    expect(zero.noEvents).toBe(true)
    expect(zero.meanDurationDays).toBeNull() // undefined without events, not 0
    expect(zero.avgAnnualHeatwaveDays).toBe(0)

    const failed = buildCityMetrics({
      location: delhi,
      heatwave: { status: 'error', error: new ApiError('network', 'x') },
      anomaly: { status: 'loading' },
    })
    expect(failed.hasHeatwave).toBe(false)
    expect(failed.totalEvents).toBeNull() // null, so it can never be displayed as 0
    expect(failed.noEvents).toBe(false)
  })

  it('has no per-year average when no year is complete', () => {
    const allIncomplete = makeAnalysis({ incompleteYears: [2018, 2019, 2020, 2021, 2022, 2023, 2024] })
    const metrics = buildCityMetrics(city(delhi, allIncomplete))
    expect(metrics.completeYears).toBe(0)
    expect(metrics.avgAnnualHeatwaveDays).toBeNull()
  })

  it('merges warnings from both responses once', () => {
    const metrics = buildCityMetrics(
      city(delhi, makeAnalysis({ warnings: ['analysis_overlaps_baseline'] }), makeAnomalies({ warnings: ['analysis_overlaps_baseline', 'years_without_anomaly:1'] })),
    )
    expect(metrics.warnings).toEqual(['analysis_overlaps_baseline', 'years_without_anomaly:1'])
  })
})

describe('buildComparisonChart', () => {
  const [delhi, mumbai] = listOf('Delhi', 'Mumbai')

  it('plots a complete year without heatwaves as zero and leaves incomplete years as gaps', () => {
    const data = buildComparisonChart(
      [city(delhi, makeAnalysis({ incompleteYears: [2024] })), city(mumbai)],
      'heatwave_days',
    )
    const row2018 = data.rows.find((r) => r.year === 2018)!
    expect(row2018.values.s0).toBe(0)
    expect(row2018.states.s0).toBe('value')
    const row2024 = data.rows.find((r) => r.year === 2024)!
    expect(row2024.values.s0).toBeNull()
    expect(row2024.states.s0).toBe('incomplete')
    expect(row2024.values.s1).not.toBeNull()
    expect(data.series[0]).toMatchObject({ plotted: 6, omitted: 1, available: true })
  })

  it('marks years without any observation as no_data, not zero', () => {
    const data = buildComparisonChart([city(delhi, makeAnalysis({ unobservedYears: [2020] })), city(mumbai)], 'heatwave_days')
    const row = data.rows.find((r) => r.year === 2020)!
    expect(row.values.s0).toBeNull()
    expect(row.states.s0).toBe('no_data')
  })

  it('uses the anomaly response for temperature charts and withholds anomalies of incomplete years', () => {
    const anomalies = makeAnomalies({ lowCoverageYears: [2019], unobservedYears: [2021] })
    const mean = buildComparisonChart([city(delhi, makeAnalysis(), anomalies), city(mumbai)], 'mean_daily_max')
    const anomaly = buildComparisonChart([city(delhi, makeAnalysis(), anomalies), city(mumbai)], 'anomaly')
    expect(mean.rows.find((r) => r.year === 2018)!.values.s0).toBe(31.2)
    expect(mean.rows.find((r) => r.year === 2019)!.states.s0).toBe('incomplete')
    expect(mean.rows.find((r) => r.year === 2021)!.states.s0).toBe('no_data')
    expect(anomaly.rows.find((r) => r.year === 2018)!.values.s0).toBe(0.4)
    expect(anomaly.rows.find((r) => r.year === 2019)!.values.s0).toBeNull()
    expect(anomaly.series[0].plotted).toBe(5)
  })

  it('shows a failed part as unavailable for that city only', () => {
    const failed: CityResult = {
      location: delhi,
      heatwave: { status: 'error', error: new ApiError('timeout', 'slow') },
      anomaly: { status: 'success', data: makeAnomalies() },
    }
    const heat = buildComparisonChart([failed, city(mumbai)], 'heatwave_days')
    expect(heat.series[0]).toMatchObject({ available: false, plotted: 0 })
    expect(heat.rows[0].states.s0).toBe('unavailable')
    expect(heat.series[1].available).toBe(true)
    const temperature = buildComparisonChart([failed, city(mumbai)], 'anomaly')
    expect(temperature.series[0].available).toBe(true) // the anomaly part of the same city still works
  })
})
