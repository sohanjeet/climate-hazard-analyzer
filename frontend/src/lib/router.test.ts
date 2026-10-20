import { describe, expect, it } from 'vitest'
import { ROUTES, navigate, pathFor, routeForPath } from '@/lib/router'
import { buildCoverageUrl, buildLocationsUrl } from '@/lib/api/client'
import { parseCoverage, parseLocations } from '@/lib/api/parse'
import { makeCoverage, makeLocations } from '@/test/geoFixtures'

describe('routes', () => {
  it('maps every path to its page, with aliases and trailing slashes', () => {
    for (const route of ROUTES) expect(routeForPath(route.path)).toBe(route.id)
    expect(routeForPath('/explore/india/')).toBe('india')
    expect(routeForPath('/compare')).toBe('compare-cities')
    expect(routeForPath('/explore')).toBe('global')
    expect(routeForPath('/nope')).toBe('not-found')
    expect(pathFor('compare-states')).toBe('/compare/states')
  })

  it('navigates with the History API and canonical paths', () => {
    navigate('/compare')
    expect(window.location.pathname).toBe('/compare/cities')
    navigate('/explore/india', { replace: true })
    expect(window.location.pathname).toBe('/explore/india')
  })
})

describe('geography API contract', () => {
  it('builds read-only URLs', () => {
    expect(buildLocationsUrl({}, 'https://api.test')).toBe('https://api.test/api/geography/locations')
    expect(buildLocationsUrl({ country: 'IND', region: 'IN-RJ' }, 'https://api.test')).toBe('https://api.test/api/geography/locations?country=IND&region=IN-RJ')
    expect(buildCoverageUrl({ startDate: '2010-01-01', endDate: '2025-12-31', country: 'IND' }, 'https://api.test')).toBe(
      'https://api.test/api/geography/coverage?start_date=2010-01-01&end_date=2025-12-31&country=IND',
    )
  })

  it('validates responses and rejects a scope other than observation_location', () => {
    expect(parseLocations(makeLocations()).locations[0].region_code).toBe('IN-RJ')
    expect(parseCoverage(makeCoverage({ startDate: '2010-01-01', endDate: '2010-12-31' })).locations[0].window_expected_days).toBe(365)
    expect(() => parseLocations({ ...makeLocations(), scope: 'state_aggregate' })).toThrow(/scope should be one of observation_location/)
    expect(() => parseLocations({ ...makeLocations(), locations: [{ id: 1 }] })).toThrow(/locations\[0\]/)
    expect(() => parseCoverage({ ...makeCoverage({ startDate: '2010-01-01', endDate: '2010-12-31' }), locations: [{ location_id: 'x', status: 'complete' }] })).toThrow()
  })
})
