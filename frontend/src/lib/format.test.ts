import { describe, expect, it } from 'vitest'
import {
  describeNote,
  describeWarning,
  formatCoordinates,
  formatDate,
  formatNumber,
  formatPValue,
  formatPercent,
  formatSigned,
  groupDateRanges,
} from './format'

describe('number formatting', () => {
  it('shows an em dash for null and non-finite values', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
  })

  it('formats with grouping and fixed digits', () => {
    expect(formatNumber(10957, 0)).toBe('10,957')
    expect(formatNumber(39.64, 1)).toBe('39.6')
  })

  it('formatSigned uses a real minus sign and no sign for zero', () => {
    expect(formatSigned(1.234)).toBe('+1.23')
    expect(formatSigned(-0.5)).toBe('−0.50')
    expect(formatSigned(0)).toBe('0.00')
    expect(formatSigned(-0.001)).toBe('0.00')
  })

  it('formats percentages and p-values', () => {
    expect(formatPercent(0.9954)).toBe('99.5%')
    expect(formatPercent(1, 0)).toBe('100%')
    expect(formatPValue(0.0004)).toBe('< 0.001')
    expect(formatPValue(0.0213)).toBe('0.021')
    expect(formatPValue(null)).toBe('—')
  })
})

describe('place and date formatting', () => {
  it('writes hemispheres instead of signs', () => {
    expect(formatCoordinates(28.6139, 77.209)).toBe('28.614°N, 77.209°E')
    expect(formatCoordinates(-33.8688, -70.5)).toBe('33.869°S, 70.500°W')
  })

  it('does not shift the day with the time zone', () => {
    expect(formatDate('2020-01-01')).toBe('1 Jan 2020')
    expect(formatDate('2020-12-31')).toBe('31 Dec 2020')
  })
})

describe('groupDateRanges', () => {
  it('collapses consecutive days into ranges', () => {
    expect(groupDateRanges(['2020-01-05', '2020-01-01', '2020-01-02', '2020-01-03'])).toEqual([
      { start: '2020-01-01', end: '2020-01-03', days: 3 },
      { start: '2020-01-05', end: '2020-01-05', days: 1 },
    ])
  })

  it('joins across month and year boundaries and ignores duplicates', () => {
    expect(groupDateRanges(['2019-12-31', '2020-01-01', '2020-01-01'])).toEqual([
      { start: '2019-12-31', end: '2020-01-01', days: 2 },
    ])
  })

  it('handles an empty list', () => {
    expect(groupDateRanges([])).toEqual([])
  })
})

describe('plain-language warnings and notes', () => {
  it('explains missing days and why counts may be too low', () => {
    const text = describeWarning('analysis_missing_days:3')
    expect(text).toContain('3 days')
    expect(text).toMatch(/underestimates/)
  })

  it('names the baseline in the overlap warning', () => {
    expect(describeWarning('analysis_overlaps_baseline', { start_year: 1991, end_year: 2020 })).toContain('1991–2020')
  })

  it('explains low-coverage baseline years, fewer-than-N and unknown codes', () => {
    expect(describeWarning('baseline_year_low_coverage:1999')).toContain('1999')
    expect(describeWarning('fewer_than_3_complete_years')).toMatch(/Fewer than 3 complete years/)
    expect(describeWarning('something_new')).toBe('something new')
  })

  it('explains trend notes', () => {
    expect(describeNote('low_statistical_power')).toMatch(/Fewer than 10/)
    expect(describeNote('event_years_only')).toMatch(/not counted as zero/)
    expect(describeNote('constant_series')).toMatch(/no p-value/)
  })
})
