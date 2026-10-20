import { describe, expect, it } from 'vitest'
import worldText from '@/data/geo/world-countries.topo.json?raw'
import indiaText from '@/data/geo/india-states.topo.json?raw'
import { parseIndia, parseWorld } from '@/lib/geo/boundaries'
import { INDIA_REGIONS, regionScopeLabel } from '@/lib/geo/regions'
import { foldText, searchPlaces } from '@/lib/geo/search'
import { FIRST_ARCHIVE_YEAR, defaultYearRange, lastCompleteYear, toDateRange, yearRangeProblem } from '@/lib/geo/period'
import { FIXTURE_LOCATIONS } from '@/test/geoFixtures'

describe('boundary data', () => {
  const india = parseIndia(indiaText)
  const world = parseWorld(worldText)

  it('has exactly the 36 current states and union territories, keyed by current ISO 3166-2:IN codes', () => {
    expect(INDIA_REGIONS).toHaveLength(36)
    expect(INDIA_REGIONS.filter((r) => r.type === 'state')).toHaveLength(28)
    expect(india.map((r) => r.id).sort()).toEqual(INDIA_REGIONS.map((r) => r.code).sort())
    // Codes ISO replaced in 2023 are gone; Ladakh (2019) and the merged DNH&DD (2020) are present.
    expect(india.map((r) => r.id)).not.toEqual(expect.arrayContaining(['IN-CT']))
    for (const code of ['IN-CG', 'IN-OD', 'IN-TS', 'IN-UK', 'IN-LA', 'IN-DH']) expect(india.some((r) => r.id === code)).toBe(true)
  })

  it('uses registry names, not the source transliterations', () => {
    expect(india.find((r) => r.id === 'IN-BR')?.name).toBe('Bihar')
    expect(india.every((r) => /^[\x20-\x7e]+$/.test(r.name))).toBe(true) // no macrons such as "Bihār"
  })

  it('every unit has a polygon geometry', () => {
    for (const unit of [...india, ...world]) expect(['Polygon', 'MultiPolygon']).toContain(unit.geometry.type)
  })

  it('has every country with unique ids, real ISO codes where they exist, and none invented', () => {
    expect(world).toHaveLength(248)
    expect(new Set(world.map((c) => c.id)).size).toBe(world.length)
    expect(world.find((c) => c.iso3 === 'IND')).toMatchObject({ name: 'India', iso2: 'IN' })
    expect(world.find((c) => c.iso3 === 'FRA')).toMatchObject({ name: 'France', iso2: 'FR' }) // ISO_A3 is -99 in the source
    expect(world.find((c) => c.name === 'Bir Tawil')).toMatchObject({ iso2: null, iso3: null })
    const iso3 = world.flatMap((c) => (c.iso3 ? [c.iso3] : []))
    expect(new Set(iso3).size).toBe(iso3.length)
  })

  it('keeps island territories on the India map', () => {
    const geometry = india.find((r) => r.id === 'IN-LD')!.geometry
    expect(geometry.type).toBe('MultiPolygon')
    expect(geometry.type === 'MultiPolygon' && geometry.coordinates.length).toBeGreaterThan(5) // the Lakshadweep islands
  })

  it('labels each observation point as a point, never as the area', () => {
    const jaipur = FIXTURE_LOCATIONS.find((l) => l.id === 'in-rj-jaipur')!
    const ludhiana = FIXTURE_LOCATIONS.find((l) => l.id === 'in-pb-ludhiana')!
    const leh = FIXTURE_LOCATIONS.find((l) => l.id === 'in-la-leh')!
    expect(regionScopeLabel(jaipur)).toBe('Capital-city observation point, not a state-wide average')
    expect(regionScopeLabel(ludhiana)).toBe('Major-city observation point, not a state-wide average')
    expect(regionScopeLabel(leh)).toBe('Capital-city observation point, not a union-territory-wide average')
  })
})

describe('place search', () => {
  const items = [
    { id: 'BRA', name: 'Brazil', codes: ['BR', 'BRA'] },
    { id: 'sp', name: 'São Paulo' },
    { id: 'IN-KL', name: 'Kerala', codes: ['IN-KL', 'KL'] },
    { id: 'IN-KA', name: 'Karnataka', codes: ['IN-KA', 'KA'] },
    { id: 'UK', name: 'United Kingdom', codes: ['GB', 'GBR'] },
    { id: 'IN-UK', name: 'Uttarakhand', codes: ['IN-UK', 'UK'] },
  ]

  it('ignores case and accents', () => {
    expect(foldText('  São ')).toBe('sao')
    expect(searchPlaces(items, 'sao').map((i) => i.id)).toEqual(['sp'])
  })

  it('matches codes exactly and ranks them first', () => {
    expect(searchPlaces(items, 'in-kl').map((i) => i.id)).toEqual(['IN-KL'])
    expect(searchPlaces(items, 'uk')[0].id).toBe('IN-UK')
    expect(searchPlaces(items, 'GBR').map((i) => i.id)).toEqual(['UK'])
  })

  it('prefers name prefixes, then word prefixes, then substrings', () => {
    expect(searchPlaces(items, 'k').map((i) => i.name)).toEqual(['Karnataka', 'Kerala', 'United Kingdom', 'Uttarakhand'])
    expect(searchPlaces(items, 'paulo').map((i) => i.id)).toEqual(['sp'])
    expect(searchPlaces(items, '')).toEqual([])
  })
})

describe('explorer periods', () => {
  const NOW = new Date(2026, 9, 14)

  it('ends at the last complete archive year', () => {
    expect(lastCompleteYear(NOW)).toBe(2025)
    expect(lastCompleteYear(new Date(2027, 0, 3))).toBe(2025) // 5-day archive lag: 2026-12-31 not served yet
    expect(defaultYearRange(NOW)).toEqual({ startYear: 2010, endYear: 2025 })
    expect(toDateRange({ startYear: 2010, endYear: 2025 })).toEqual({ startDate: '2010-01-01', endDate: '2025-12-31' })
  })

  it('applies the backend window rules', () => {
    expect(yearRangeProblem({ startYear: 2010, endYear: 2025 }, NOW)).toBeNull()
    expect(yearRangeProblem({ startYear: 2020, endYear: 2010 }, NOW)).toMatch(/on or before/)
    expect(yearRangeProblem({ startYear: FIRST_ARCHIVE_YEAR - 1, endYear: 2020 }, NOW)).toMatch(/1940/)
    expect(yearRangeProblem({ startYear: 1940, endYear: 2030 }, NOW)).toMatch(/2025/)
  })
})
