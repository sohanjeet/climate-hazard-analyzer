/**
 * Rebuilds the static boundary files used by the map pages (see docs/geospatial_architecture.md, section 4).
 *
 *   node scripts/build-geo.mjs
 *
 * Downloads two pinned source files, verifies their SHA-256, simplifies them with a pinned mapshaper (run through
 * npx, so it is not a project dependency), applies the documented corrections and writes:
 *   src/data/geo/world-countries.topo.json   Natural Earth 1:10m Admin 0, India point of view (public domain)
 *   src/data/geo/india-states.topo.json      geoBoundaries IND ADM1 (CC BY 2.5 IN, DataMeet / ECI)
 *   src/data/geo/sources.json                provenance shown on the Methodology page
 * Downloads go to a fresh temporary directory and are read only as data.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src', 'data', 'geo')
const MAPSHAPER = 'mapshaper@0.7.72'

const SOURCES = {
  world: {
    title: 'Natural Earth 1:10m Admin 0 – Countries, India point of view',
    version: 'natural-earth-vector v5.1.2',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries_ind.geojson',
    sha256: '3e67a5a6ddeff3247ca8400cd2514fd4a5ac6e5432823b25d610a7028597d45f',
    license: 'Public domain (Natural Earth terms of use)',
    licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    attribution: 'Made with Natural Earth.',
    // Simplification tolerance in metres (Visvalingam effective-area interval), evaluated per part: 6 km for parts
    // under 10,000 km2 (islands such as the Andaman group stay recognisable), 20 km for larger landmasses (about two
    // pixels at the world map's 4x zoom). World coastlines are therefore generalised by up to ~20 km.
    simplify: 'variable interval=this.area<1e10?6000:20000',
    // Detached parts below this area are dropped (each country keeps its largest part); India's own layer keeps all.
    minIslandKm2: 150,
  },
  india: {
    title: 'geoBoundaries IND ADM1 (States and Union Territories)',
    version: 'geoBoundaries gbOpen, commit 9469f09 (built 2023-12-12)',
    url: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson',
    sha256: '4c63fe43294a391e8f2de4e9f86f3edb60f8688275b9fee90c61fb2aa0c26061',
    license: 'Creative Commons Attribution 2.5 India (CC BY 2.5 IN)',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.5/in/',
    attribution: 'Boundaries: geoBoundaries (Runfola et al. 2020), from DataMeet India community and Election Commission of India data, CC BY 2.5 IN.',
    simplify: 'interval=1000',
  },
}

// geoBoundaries still uses four ISO 3166-2:IN codes that ISO replaced in 2023.
const ISO_CODE_UPDATES = { 'IN-CT': 'IN-CG', 'IN-OR': 'IN-OD', 'IN-TG': 'IN-TS', 'IN-UT': 'IN-UK' }

const regions = JSON.parse(readFileSync(join(root, 'src', 'lib', 'geo', 'india-regions.json'), 'utf8'))
const regionByCode = new Map(regions.map((r) => [r.code, r]))

async function download(source, dir, name) {
  const response = await fetch(source.url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${source.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== source.sha256) throw new Error(`SHA-256 mismatch for ${name}: expected ${source.sha256}, got ${digest}`)
  const path = join(dir, `${name}.geojson`)
  writeFileSync(path, bytes)
  return path
}

function simplify(input, output, { idField, fields, percentage, minIslandKm2 = 0 }) {
  // Optionally drop detached parts smaller than minIslandKm2, but never a feature's largest part, so no country
  // disappears (sub-pixel islets at world scale would otherwise double the file size).
  const islandFilter = minIslandKm2 > 0
    ? [
        '-each', JSON.stringify(`global.m = global.m || {}; global.m[${idField}] = Math.max(global.m[${idField}] || 0, this.area)`),
        '-filter', JSON.stringify(`this.area >= ${minIslandKm2 * 1e6} || this.area === global.m[${idField}]`),
      ]
    : []
  const command = [
    'npx', '--yes', MAPSHAPER,
    '-i', JSON.stringify(input),
    '-filter-fields', fields,
    // keep-shapes only protects a feature's largest ring, so split every multi-part feature into single parts
    // first: then no island (Lakshadweep, Andaman and Nicobar) collapses. They are merged back afterwards.
    '-explode',
    ...islandFilter,
    // Visvalingam with a shape-weighting factor.
    '-simplify', ...percentage.split(' ').map((part) => JSON.stringify(part)), 'weighted', 'keep-shapes',
    '-dissolve2', idField, `copy-fields=${fields}`,
    '-o', 'format=topojson', 'quantization=100000', JSON.stringify(output),
  ].join(' ')
  execSync(command, { stdio: 'inherit' })
  return JSON.parse(readFileSync(output, 'utf8'))
}

/** Renames the single object of a TopoJSON file and rewrites each geometry's id and properties. */
function retag(topology, objectName, mapGeometry) {
  const [first] = Object.values(topology.objects)
  first.geometries = first.geometries.map(mapGeometry)
  topology.objects = { [objectName]: first }
  return topology
}

const validIso = (value) => (typeof value === 'string' && /^[A-Z]{2,3}$/.test(value) ? value : null)

function buildWorld(topology) {
  const result = retag(topology, 'countries', (g) => {
    const p = g.properties
    // ISO_A3 is -99 for France and Norway, whose codes live in ISO_A3_EH. Dependencies that share their parent's
    // _EH code (for example Clipperton -> FRA) get no ISO code of their own rather than a duplicate.
    const iso3 = validIso(p.ISO_A3) ?? (validIso(p.ISO_A3_EH) === p.ADM0_A3 ? p.ADM0_A3 : null)
    const iso2 = iso3 ? (validIso(p.ISO_A2) ?? validIso(p.ISO_A2_EH)) : null
    return { type: g.type, arcs: g.arcs, id: p.ADM0_A3, properties: { name: p.NAME, iso2, iso3 } }
  })
  const ids = result.objects.countries.geometries.map((g) => g.id)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate country ids in the world layer')
  const iso3s = result.objects.countries.geometries.map((g) => g.properties.iso3).filter(Boolean)
  if (new Set(iso3s).size !== iso3s.length) throw new Error('Duplicate ISO alpha-3 codes in the world layer')
  return result
}

function buildIndia(topology) {
  const result = retag(topology, 'regions', (g) => {
    const code = ISO_CODE_UPDATES[g.properties.shapeISO] ?? g.properties.shapeISO
    const region = regionByCode.get(code)
    if (!region) throw new Error(`Unknown region code in the India layer: ${code}`)
    return { type: g.type, arcs: g.arcs, id: code, properties: { name: region.name, type: region.type } }
  })
  const codes = result.objects.regions.geometries.map((g) => g.id).sort()
  const expected = [...regionByCode.keys()].sort()
  if (codes.join() !== expected.join()) throw new Error(`India layer codes differ from the registry: ${codes.join()}`)
  return result
}

const work = mkdtempSync(join(tmpdir(), 'chta-geo-'))
try {
  const worldIn = await download(SOURCES.world, work, 'world')
  const indiaIn = await download(SOURCES.india, work, 'india')
  const world = buildWorld(simplify(worldIn, join(work, 'world.topo.json'), { idField: 'ADM0_A3', fields: 'ADM0_A3,ISO_A2,ISO_A2_EH,ISO_A3,ISO_A3_EH,NAME', percentage: SOURCES.world.simplify, minIslandKm2: SOURCES.world.minIslandKm2 }))
  const india = buildIndia(simplify(indiaIn, join(work, 'india.topo.json'), { idField: 'shapeISO', fields: 'shapeISO', percentage: SOURCES.india.simplify }))
  writeFileSync(join(outDir, 'world-countries.topo.json'), JSON.stringify(world))
  writeFileSync(join(outDir, 'india-states.topo.json'), JSON.stringify(india))
  const provenance = Object.fromEntries(
    Object.entries(SOURCES).map(([key, s]) => [key, { title: s.title, version: s.version, url: s.url, sha256: s.sha256, license: s.license, licenseUrl: s.licenseUrl, attribution: s.attribution, simplify: s.simplify, minIslandKm2: s.minIslandKm2 ?? 0 }]),
  )
  writeFileSync(
    join(outDir, 'sources.json'),
    `${JSON.stringify({ crs: 'EPSG:4326 (WGS 84 longitude/latitude, degrees)', tool: MAPSHAPER, isoCodeUpdates: ISO_CODE_UPDATES, sources: provenance }, null, 2)}\n`,
  )
  console.log(`world: ${world.objects.countries.geometries.length} features; india: ${india.objects.regions.geometries.length} features`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
