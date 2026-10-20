import type { ObservationLocation } from '@/lib/api/types'
import regions from './india-regions.json'

export type IndiaRegionType = 'state' | 'union_territory'

export interface IndiaRegion {
  /** Current ISO 3166-2:IN code, e.g. IN-RJ. */
  code: string
  name: string
  type: IndiaRegionType
}

/** The 36 current states and union territories (mirrors backend INDIA_REGIONS). */
export const INDIA_REGIONS: readonly IndiaRegion[] = regions as IndiaRegion[]

const byCode = new Map(INDIA_REGIONS.map((r) => [r.code, r]))

export const regionByCode = (code: string): IndiaRegion | undefined => byCode.get(code)

export const REGION_TYPE_LABEL: Record<IndiaRegionType, string> = { state: 'State', union_territory: 'Union territory' }

/** Says what the point is and what it is not. */
export function regionScopeLabel(location: ObservationLocation): string {
  const region = location.region_code ? regionByCode(location.region_code) : undefined
  const area = region?.type === 'union_territory' ? 'union-territory-wide' : 'state-wide'
  return `${location.role === 'capital' ? 'Capital-city' : 'Major-city'} observation point, not a ${area} average`
}
