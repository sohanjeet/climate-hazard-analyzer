import { describe, expect, it } from 'vitest'
import { apiBaseUrlProblem } from './buildEnv'

const local = { hosted: false }
const hosted = { hosted: true }

describe('apiBaseUrlProblem', () => {
  it.each([undefined, '', '   '])('fails the build when the variable is missing or blank (%j)', (value) => {
    expect(apiBaseUrlProblem(value, local)).toMatchObject({ level: 'error', message: expect.stringContaining('not set') })
    expect(apiBaseUrlProblem(value, hosted)?.level).toBe('error')
  })

  it.each(['not a url', 'api.example.com', 'ftp://api.example.com'])('rejects %j', (value) => {
    expect(apiBaseUrlProblem(value, local)?.level).toBe('error')
  })

  it('accepts an https backend URL, with or without a trailing slash', () => {
    expect(apiBaseUrlProblem('https://api.example.com', hosted)).toBeNull()
    expect(apiBaseUrlProblem('https://api.example.com/', hosted)).toBeNull()
  })

  it('only warns about localhost on a local build, but fails it on the hosting platform', () => {
    for (const value of ['http://localhost:8000', 'http://127.0.0.1:8000']) {
      expect(apiBaseUrlProblem(value, local)?.level).toBe('warning')
      expect(apiBaseUrlProblem(value, hosted)?.level).toBe('error')
    }
  })

  it('requires https on the hosting platform but allows http locally', () => {
    expect(apiBaseUrlProblem('http://api.example.com', hosted)).toMatchObject({ level: 'error' })
    expect(apiBaseUrlProblem('http://api.example.com', local)).toBeNull()
  })
})
