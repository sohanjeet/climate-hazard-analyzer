import { feature } from 'topojson-client'
import type { Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { regionByCode, type IndiaRegionType } from './regions'

/**
 * Static boundary layers (built by scripts/build-geo.mjs; sources and licences in src/data/geo/sources.json).
 * They are imported as raw text so they become separate, content-hashed chunks: loaded only by the map pages,
 * cached immutably by the browser, and parsed once per session.
 */

export interface MapFeature {
  id: string
  name: string
  geometry: Geometry
}

export interface CountryFeature extends MapFeature {
  /** ISO 3166-1 codes; null for units without their own code (for example Bir Tawil). */
  iso2: string | null
  iso3: string | null
}

export interface RegionFeature extends MapFeature {
  type: IndiaRegionType
}

type Props = Record<string, unknown>

function toFeatures<P extends Props>(text: string, object: string): { id: string; properties: P; geometry: Geometry }[] {
  const topology = JSON.parse(text) as Topology<{ [key: string]: GeometryCollection<P> }>
  const collection = feature(topology, topology.objects[object])
  return collection.features.map((f) => ({ id: String(f.id), properties: f.properties as P, geometry: f.geometry }))
}

export function parseWorld(text: string): CountryFeature[] {
  return toFeatures<{ name: string; iso2: string | null; iso3: string | null }>(text, 'countries')
    .map((f) => ({ id: f.id, name: f.properties.name, iso2: f.properties.iso2, iso3: f.properties.iso3, geometry: f.geometry }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function parseIndia(text: string): RegionFeature[] {
  return toFeatures<{ name: string; type: IndiaRegionType }>(text, 'regions')
    .map((f) => ({ id: f.id, name: regionByCode(f.id)?.name ?? f.properties.name, type: f.properties.type, geometry: f.geometry }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

let world: Promise<CountryFeature[]> | null = null
let india: Promise<RegionFeature[]> | null = null

export function loadWorld(): Promise<CountryFeature[]> {
  world ??= import('@/data/geo/world-countries.topo.json?raw').then((m) => parseWorld(m.default))
  world.catch(() => {
    world = null // a failed chunk load (offline, deploy in progress) can be retried
  })
  return world
}

export function loadIndia(): Promise<RegionFeature[]> {
  india ??= import('@/data/geo/india-states.topo.json?raw').then((m) => parseIndia(m.default))
  india.catch(() => {
    india = null
  })
  return india
}
