import { describe, expect, it } from 'vitest'
import { ApiError, MAX_RETRY_AFTER_SECONDS, describeError, kindForStatus, parseErrorBody, parseRetryAfter } from './errors'

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5)
    expect(parseRetryAfter(' 12 ')).toBe(12)
  })

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')
    expect(parseRetryAfter('Wed, 14 Oct 2026 12:00:30 GMT', now)).toBe(30)
  })

  it('never returns less than one second, and clamps very long waits', () => {
    expect(parseRetryAfter('0')).toBe(1)
    expect(parseRetryAfter('99999')).toBe(MAX_RETRY_AFTER_SECONDS)
    const now = Date.parse('2026-10-14T12:00:00Z')
    expect(parseRetryAfter('Wed, 14 Oct 2026 11:00:00 GMT', now)).toBe(1)
  })

  it('ignores missing or malformed values', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
    expect(parseRetryAfter('-4')).toBeNull()
  })
})

describe('parseErrorBody', () => {
  it('reads the backend error shape', () => {
    expect(parseErrorBody({ detail: { error: 'Rate limit exceeded; retry later' } })).toEqual({
      message: 'Rate limit exceeded; retry later',
      fieldErrors: [],
    })
  })

  it('reads field errors from a 422', () => {
    const body = {
      detail: {
        error: 'Invalid request parameters',
        errors: [{ field: 'latitude', message: 'Input should be less than or equal to 90' }, { nope: true }],
      },
    }
    expect(parseErrorBody(body)).toEqual({
      message: 'Invalid request parameters',
      fieldErrors: [{ field: 'latitude', message: 'Input should be less than or equal to 90' }],
    })
  })

  it('falls back for plain strings, FastAPI lists and junk', () => {
    expect(parseErrorBody({ detail: 'Bad gateway' }).message).toBe('Bad gateway')
    expect(
      parseErrorBody({ detail: [{ loc: ['query', 'latitude'], msg: 'bad' }] }).fieldErrors,
    ).toEqual([{ field: 'latitude', message: 'bad' }])
    expect(parseErrorBody(null)).toEqual({ message: null, fieldErrors: [] })
    expect(parseErrorBody('<html>')).toEqual({ message: null, fieldErrors: [] })
    expect(parseErrorBody({ detail: { error: 42 } }).message).toBeNull()
  })
})

describe('kindForStatus', () => {
  it.each([
    [422, 'validation'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [504, 'timeout'],
    [502, 'upstream'],
    [500, 'server'],
    [501, 'server'],
    [404, 'http'],
  ] as const)('maps %i to %s', (status, kind) => {
    expect(kindForStatus(status)).toBe(kind)
  })
})

describe('describeError', () => {
  it('marks transient failures retryable and validation errors not', () => {
    expect(describeError(new ApiError('rate_limited', 'x')).retryable).toBe(true)
    expect(describeError(new ApiError('unavailable', 'x')).retryable).toBe(true)
    expect(describeError(new ApiError('timeout', 'x')).retryable).toBe(true)
    expect(describeError(new ApiError('network', 'x')).retryable).toBe(true)
    expect(describeError(new ApiError('validation', 'x')).retryable).toBe(false)
    expect(describeError(new ApiError('invalid_response', 'x')).retryable).toBe(false)
  })
})
