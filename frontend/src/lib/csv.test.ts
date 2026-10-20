import { describe, expect, it } from 'vitest'
import { COMPARISON_CSV_HEADER, buildComparisonCsv, csvCell, toCsv } from '@/lib/csv'
import type { CityResult } from '@/lib/comparison'
import { ApiError } from '@/lib/api/errors'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'

describe('csv cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Rajasthan · Jaipur')).toBe('Rajasthan · Jaipur')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(true)).toBe('true')
  })

  it('neutralises spreadsheet formulas in text but keeps negative numbers numeric', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-0.4)).toBe('-0.4')
    expect(csvCell(Number.NaN)).toBe('')
  })

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 1], ['b', null]])).toBe('a,1\r\nb,\r\n')
  })
})

describe('comparison export', () => {
  const jaipur: CityResult = {
    location: { id: '26.9124,75.7873', name: 'Rajasthan · Jaipur', latitude: 26.9124, longitude: 75.7873, slot: 0 },
    heatwave: { status: 'success', data: makeAnalysis() },
    anomaly: { status: 'success', data: makeAnomalies() },
  }
  const failed: CityResult = {
    location: { id: '8.5241,76.9366', name: 'Kerala · Thiruvananthapuram', latitude: 8.5241, longitude: 76.9366, slot: 1 },
    heatwave: { status: 'error', error: new ApiError('upstream', 'x') },
    anomaly: { status: 'error', error: new ApiError('upstream', 'x') },
  }

  it('writes one row per location and year, labelled as observation-location scope', () => {
    const csv = buildComparisonCsv([jaipur, failed], () => ({ code: 'IN-RJ', name: 'Rajasthan' }))
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(COMPARISON_CSV_HEADER.join(','))
    expect(lines).toHaveLength(1 + 7) // 2018-2024 for Jaipur; the failed location has no rows
    const first = lines[1].split(',')
    expect(first[0]).toBe('observation_location (not an area aggregate)')
    expect(first.slice(1, 7)).toEqual(['IN-RJ', 'Rajasthan', 'Rajasthan · Jaipur', '26.9124', '75.7873', '2018'])
    expect(first.at(-1)).toBe('1991-2020')
    // 2018 has no events in the fixture: the count is 0, the duration is empty (never 0).
    const row2018 = Object.fromEntries(COMPARISON_CSV_HEADER.map((h, i) => [h, first[i]]))
    expect(row2018.heatwave_events).toBe('0')
    expect(row2018.mean_event_duration_days).toBe('')
  })
})
