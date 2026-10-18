import { describe, expect, it } from 'vitest'
import {
  defaultFormValues,
  formFieldForApiField,
  formFieldForMessage,
  fullCalendarYears,
  isRealIsoDate,
  latestArchiveDate,
  validateForm,
  type FormValues,
} from './validation'

// 14 Oct 2026: the archive then ends on 9 Oct 2026 (5-day lag).
const NOW = new Date(2026, 9, 14)

const valid: FormValues = {
  latitude: '28.6139',
  longitude: '77.2090',
  startDate: '2010-01-01',
  endDate: '2025-12-31',
  rollingWindowYears: '5',
}

const check = (overrides: Partial<FormValues>) => validateForm({ ...valid, ...overrides }, NOW)

describe('validateForm', () => {
  it('accepts valid input and returns numbers', () => {
    const { errors, request } = check({})
    expect(errors).toEqual({})
    expect(request).toEqual({
      latitude: 28.6139,
      longitude: 77.209,
      startDate: '2010-01-01',
      endDate: '2025-12-31',
      rollingWindowYears: 5,
    })
  })

  it.each([
    ['90', true],
    ['-90', true],
    ['90.0001', false],
    ['-90.5', false],
  ])('latitude %s -> valid=%s', (latitude, ok) => {
    expect(Boolean(check({ latitude }).errors.latitude)).toBe(!ok)
  })

  it.each([
    ['180', true],
    ['-180', true],
    ['180.1', false],
    ['-181', false],
  ])('longitude %s -> valid=%s', (longitude, ok) => {
    expect(Boolean(check({ longitude }).errors.longitude)).toBe(!ok)
  })

  it.each(['', '  ', 'abc', '12,5', '1e2', '0x10', 'NaN', 'Infinity', '--5'])('rejects non-numeric coordinate %j', (text) => {
    const { errors, request } = check({ latitude: text, longitude: text })
    expect(errors.latitude).toBeTruthy()
    expect(errors.longitude).toBeTruthy()
    expect(request).toBeNull()
  })

  it('accepts signs and bare decimals', () => {
    expect(check({ latitude: '+12.5', longitude: '.5' }).errors).toEqual({})
    expect(check({ latitude: '-0', longitude: '5.' }).errors).toEqual({})
  })

  it('requires both dates', () => {
    const { errors } = check({ startDate: '', endDate: '' })
    expect(errors.startDate).toMatch(/start date/i)
    expect(errors.endDate).toMatch(/end date/i)
  })

  it('rejects an end date before the start date', () => {
    expect(check({ startDate: '2020-06-01', endDate: '2020-05-31' }).errors.endDate).toMatch(/on or after/)
  })

  it('accepts a single-day range', () => {
    expect(check({ startDate: '2020-06-01', endDate: '2020-06-01' }).errors).toEqual({})
  })

  it('enforces the archive bounds (1940-01-01 to today minus 5 days)', () => {
    expect(check({ startDate: '1939-12-31' }).errors.startDate).toMatch(/1940/)
    expect(check({ startDate: '1940-01-01' }).errors.startDate).toBeUndefined()
    expect(check({ endDate: '2026-10-09' }).errors.endDate).toBeUndefined()
    expect(check({ endDate: '2026-10-10' }).errors.endDate).toMatch(/2026-10-09/)
  })

  it('limits the range to 90 calendar years, counted as the backend does', () => {
    expect(check({ startDate: '1940-01-01', endDate: '2025-12-31' }).errors.endDate).toBeUndefined() // 86 years
    expect(check({ startDate: '1940-01-01', endDate: '2029-12-31' }).errors.endDate).toBeTruthy() // beyond the archive
    const now = new Date(2040, 0, 1)
    expect(validateForm({ ...valid, startDate: '1940-01-01', endDate: '2029-12-31' }, now).errors.endDate).toBeUndefined() // 90 years
    expect(validateForm({ ...valid, startDate: '1940-01-01', endDate: '2030-01-01' }, now).errors.endDate).toMatch(/90/) // 91 years
  })

  it('rejects impossible calendar dates', () => {
    expect(check({ startDate: '2021-02-30' }).errors.startDate).toBeTruthy()
  })

  it.each([
    ['1', false],
    ['2', true],
    ['30', true],
    ['31', false],
    ['', false],
    ['3.5', false],
    ['abc', false],
  ])('rolling window %j -> valid=%s', (rollingWindowYears, ok) => {
    expect(Boolean(check({ rollingWindowYears }).errors.rollingWindowYears)).toBe(!ok)
  })

  it('reports every problem at once', () => {
    const { errors } = check({ latitude: '100', longitude: 'x', startDate: '', rollingWindowYears: '1' })
    expect(Object.keys(errors).sort()).toEqual(['latitude', 'longitude', 'rollingWindowYears', 'startDate'])
  })
})

describe('date helpers', () => {
  it('latestArchiveDate subtracts the 5-day lag across month boundaries', () => {
    expect(latestArchiveDate(new Date(2026, 9, 14))).toBe('2026-10-09')
    expect(latestArchiveDate(new Date(2026, 2, 3))).toBe('2026-02-26')
    expect(latestArchiveDate(new Date(2024, 2, 3))).toBe('2024-02-27')
  })

  it('isRealIsoDate', () => {
    expect(isRealIsoDate('2024-02-29')).toBe(true)
    expect(isRealIsoDate('2023-02-29')).toBe(false)
    expect(isRealIsoDate('2023-13-01')).toBe(false)
    expect(isRealIsoDate('23-01-01')).toBe(false)
  })

  it('fullCalendarYears counts only years wholly inside the range', () => {
    expect(fullCalendarYears('2010-01-01', '2025-12-31')).toBe(16)
    expect(fullCalendarYears('2010-01-02', '2025-12-31')).toBe(15)
    expect(fullCalendarYears('2010-01-01', '2025-12-30')).toBe(15)
    expect(fullCalendarYears('2010-03-01', '2011-10-01')).toBe(0)
    expect(fullCalendarYears('2025-12-31', '2010-01-01')).toBe(0)
  })

  it('defaultFormValues ends on the last full calendar year inside the archive and passes validation', () => {
    expect(defaultFormValues(NOW).endDate).toBe('2025-12-31')
    expect(defaultFormValues(new Date(2027, 0, 20)).endDate).toBe('2026-12-31') // archive end is 15 Jan 2027, 2026 is full
    expect(defaultFormValues(new Date(2027, 0, 2)).endDate).toBe('2025-12-31') // archive end is 28 Dec 2026, not yet full
    expect(validateForm(defaultFormValues(NOW), NOW).request).not.toBeNull()
  })
})

describe('backend error mapping', () => {
  it('maps query parameter names to form fields', () => {
    expect(formFieldForApiField('latitude')).toBe('latitude')
    expect(formFieldForApiField('start_date')).toBe('startDate')
    expect(formFieldForApiField('end_date')).toBe('endDate')
    expect(formFieldForApiField('rolling_window_years')).toBe('rollingWindowYears')
    expect(formFieldForApiField('baseline_start_year')).toBeNull()
  })

  it('guesses a field for service-level 422 messages', () => {
    expect(formFieldForMessage('latitude must be between -90 and 90')).toBe('latitude')
    expect(formFieldForMessage('start_date must be on or before end_date')).toBe('endDate')
    expect(formFieldForMessage('dates must be between 1940-01-01 and 2026-10-09 for the historical archive')).toBe('endDate')
    expect(formFieldForMessage('analysis window cannot exceed 90 calendar years')).toBe('endDate')
    expect(formFieldForMessage('rolling window must be between 2 and 30 years')).toBe('rollingWindowYears')
    expect(formFieldForMessage('baseline period has insufficient valid observations')).toBeNull()
  })
})
