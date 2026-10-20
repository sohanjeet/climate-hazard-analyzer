import { vi } from 'vitest'
import type { GeographyApi } from '@/hooks/useGeography'
import type { CoverageRequest, CoverageResponse, CoverageStatus, LocationsResponse, ObservationLocation } from '@/lib/api/types'

/** A small catalog shaped like GET /api/geography/locations (coordinates match the backend catalog). */
export const FIXTURE_LOCATIONS: ObservationLocation[] = [
  { id: 'in-rj-jaipur', name: 'Jaipur', latitude: 26.9124, longitude: 75.7873, country_code: 'IND', country_name: 'India', region_code: 'IN-RJ', region_name: 'Rajasthan', role: 'capital', role_note: null },
  { id: 'in-dl-delhi', name: 'Delhi', latitude: 28.6139, longitude: 77.209, country_code: 'IND', country_name: 'India', region_code: 'IN-DL', region_name: 'Delhi', role: 'capital', role_note: null },
  { id: 'in-kl-thiruvananthapuram', name: 'Thiruvananthapuram', latitude: 8.5241, longitude: 76.9366, country_code: 'IND', country_name: 'India', region_code: 'IN-KL', region_name: 'Kerala', role: 'capital', role_note: 'Coastal or island point: the nearest reanalysis grid cell may be partly sea.' },
  { id: 'in-pb-ludhiana', name: 'Ludhiana', latitude: 30.901, longitude: 75.8573, country_code: 'IND', country_name: 'India', region_code: 'IN-PB', region_name: 'Punjab', role: 'major_city', role_note: 'The state capital, Chandigarh, is a separate union territory, so a major city inside the state is used.' },
  { id: 'in-la-leh', name: 'Leh', latitude: 34.1526, longitude: 77.5771, country_code: 'IND', country_name: 'India', region_code: 'IN-LA', region_name: 'Ladakh', role: 'capital', role_note: null },
  { id: 'in-tn-chennai', name: 'Chennai', latitude: 13.0827, longitude: 80.2707, country_code: 'IND', country_name: 'India', region_code: 'IN-TN', region_name: 'Tamil Nadu', role: 'capital', role_note: null },
  { id: 'fra-paris', name: 'Paris', latitude: 48.8566, longitude: 2.3522, country_code: 'FRA', country_name: 'France', region_code: null, region_name: null, role: 'capital', role_note: null },
  { id: 'usa-new-york', name: 'New York', latitude: 40.7128, longitude: -74.006, country_code: 'USA', country_name: 'United States', region_code: null, region_name: null, role: 'major_city', role_note: null },
  { id: 'usa-phoenix', name: 'Phoenix', latitude: 33.4484, longitude: -112.074, country_code: 'USA', country_name: 'United States', region_code: null, region_name: null, role: 'major_city', role_note: null },
]

export function makeLocations(locations: ObservationLocation[] = FIXTURE_LOCATIONS): LocationsResponse {
  return {
    scope: 'observation_location',
    scope_note: 'Each location is the reanalysis grid cell nearest its coordinates.',
    count: locations.length,
    locations,
  }
}

export function makeCoverage(request: CoverageRequest, status: Partial<Record<string, CoverageStatus>> = {}): CoverageResponse {
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1
  const window = days(request.startDate, request.endDate)
  return {
    scope: 'observation_location',
    start_date: request.startDate,
    end_date: request.endDate,
    baseline_start_year: 1991,
    baseline_end_year: 2020,
    status_note: 'storage only',
    locations: FIXTURE_LOCATIONS.filter((l) => !request.country || l.country_code === request.country).map((l) => {
      const s = status[l.id] ?? 'not_stored'
      return {
        location_id: l.id,
        baseline_stored_days: s === 'stored' ? 10958 : s === 'partial' ? 5000 : 0,
        baseline_expected_days: 10958,
        window_stored_days: s === 'stored' ? window : 0,
        window_expected_days: window,
        status: s,
      }
    }),
  }
}

export function fakeGeography(options: { status?: Partial<Record<string, CoverageStatus>>; failLocations?: boolean; failCoverage?: boolean } = {}) {
  const api = {
    locations: vi.fn(async () => {
      if (options.failLocations) throw new (await import('@/lib/api/errors')).ApiError('network', 'down')
      return makeLocations()
    }),
    coverage: vi.fn(async (request: CoverageRequest) => {
      if (options.failCoverage) throw new (await import('@/lib/api/errors')).ApiError('unavailable', 'db down', { status: 503 })
      return makeCoverage(request, options.status)
    }),
  }
  return api as typeof api & GeographyApi
}
