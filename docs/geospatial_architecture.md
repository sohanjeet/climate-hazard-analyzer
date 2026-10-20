# Phase 10: geospatial climate explorer — architecture, data sources and analysis semantics

Status: proposed design, implemented in subphases (10A to 10F). This document is the reference for what the map
pages may and may not claim.

## 1. Audit of the existing code (10A)

| Area | Finding | Reuse in Phase 10 |
|---|---|---|
| App shell | `App.tsx` switches two views (`analyzer`, `compare`) with React state. No router; the comparison view mounts on first open and then stays mounted (hidden) so its state survives view switches. | Keep the keep-mounted pattern; replace the view state with URL routes. |
| Navigation | `AppHeader` has a "Views" nav (two buttons) and an in-page "Result sections" nav. | Extend to seven routes; result-section nav kept for the dashboard. |
| API client | `lib/api/client.ts`: `getJson` with timeout, caller abort, `ApiError` kinds, `Retry-After`, runtime response validation (`parse.ts`). | Reused unchanged; new geography calls go through the same `getJson`. |
| Analysis hooks | `useHeatwaveAnalysis`, `useAnomalyAnalysis`, `useComparison` (2 to 4 locations, concurrency 2, per-location/per-part state, retry, abort on new run). | `useComparison` drives the state comparison as-is. Explorer pages use a session cache in front of the same fetchers. |
| Comparison UI | `ComparisonCards`, `ComparisonTable`, `CityStatusList`, `CoverageNotes`, `ComparisonCharts` (three line charts), `SeriesSwatch`/`Marker` (colour + shape + dash). | Reused for the state comparison; a grouped bar chart and CSV export are added. |
| Metric extraction | `lib/comparison.ts`: `buildCityMetrics`, `buildComparisonChart` read values straight from API responses and never recompute averages. | Reused for marker values and state comparison. |
| Design system | OKLCH tokens in `index.css`, light/dark via the `dark` class (follows the OS), validated categorical `--series-1..4`, `--heat`/`--cool` for anomalies, shadcn-style `ui/*`. | Reused; map colours become tokens; a manual theme toggle is added. |
| Backend endpoints | `GET /api/heatwaves`, `/api/temperature-anomalies`, `/api/weather`; all point-based (one grid cell). Rate limits: 60/min general, 20/min per heavy endpoint. | Unchanged. Two read-only geography endpoints are added (section 6). |
| Storage | `weather_records` unique `(location_key, date)`; `location_key` is `"%.6f,%.6f"` of the request coordinates; `analysis_results` is write-only history. | Coverage is read from `weather_records` with an index-only aggregation. `analysis_results` is not read back. |
| Tests | Backend 275 passing (pytest). Frontend 232 passing (Vitest). | All must stay green. |
| **Test safety finding** | Integration fixtures connect with `get_settings().mongodb_uri`, which comes from `backend/.env`. That file points at Atlas (`mongodb+srv://`), so a plain `pytest` run creates and drops `test_*` databases **on the Atlas cluster**. | Fixed in 10E: tests always use `TEST_MONGODB_URI` (default `mongodb://localhost:27017`) and refuse a remote URI unless explicitly allowed. |

## 2. Target architecture

```
                    static, lazy, hashed chunks (immutable cache)
  src/data/geo/world-countries.topo.json   src/data/geo/india-states.topo.json
                 \                                   /
                  v                                 v
  routes ──> GlobalExplorer / IndiaExplorer / StateComparison (lazy pages)
                  |            |                     |
                  |            |                     +--> useComparison (existing) --+
                  v            v                                                     |
           GeoMap (d3-geo + d3-zoom, SVG)     useLocationAnalysis (session cache) ---+--> fetchHeatwaves /
                  |                                                                       fetchTemperatureAnomalies
                  +--> useGeography: GET /api/geography/locations   (catalog, cached for the session)
                                     GET /api/geography/coverage    (stored-record counts, no ingestion)
```

Frontend modules:

- `lib/router.ts`: a small History API router (about 60 lines). Routes: `/` Dashboard (the existing analyzer),
  `/explore/global`, `/explore/india`, `/compare/cities` (the existing comparison; `/compare` redirects),
  `/compare/states`, `/anomalies`, `/methodology`, and a not-found page. A full router library is not needed for
  seven flat routes.
- `components/map/GeoMap.tsx`: one reusable SVG map: polygons, hover highlight, tooltip, click and keyboard
  selection, zoom/pan, reset, point markers.
- `lib/geo/*`: boundary loading (`import()` of the TopoJSON, memoised), the Indian state/UT registry, colour scales,
  search.
- `pages/*`: the new pages, each `React.lazy`-loaded so the map code and boundary data never reach the dashboard
  bundle.

## 3. Map technology (10F)

| Option | Polygons / choropleth / tooltip / click / zoom | Size (min+gz, approx.) | Basemap or key | Verdict |
|---|---|---|---|---|
| react-simple-maps 3.0 | yes | ~35 kB + d3 deps | none | Last release 2022, peer range stops at React 18; this app is on React 19. Rejected as unmaintained. |
| MapLibre GL JS | yes (WebGL) | ~220 kB | needs a style/tiles (self-hosted or a provider) | Too large for two static choropleths. Rejected. |
| Leaflet + React Leaflet | yes | ~45 kB + wrapper | raster tiles from a provider for context | Tile provider dependency, poor fit for an un-tiled thematic map. Rejected. |
| **d3-geo + d3-zoom + topojson-client, rendered as React SVG** | yes | ~25 kB total | none | **Chosen.** Smallest, maintained (d3 org), no API key, full control of accessibility and design tokens. |

Projections: Equal Earth for the world (equal-area, standard for thematic world maps). A conic equal-area
projection (standard parallels 12°N and 28°N, central meridian 80°E) for India, so state areas are not distorted on
a thematic map. Both run in the browser via d3-geo.

## 4. Geographic data sources, licensing, CRS and updates

| Layer | Source (pinned) | Licence | Notes |
|---|---|---|---|
| World countries | Natural Earth 1:10m Admin 0 Countries, **India point-of-view** (`ne_10m_admin_0_countries_ind.geojson`), natural-earth-vector tag `v5.1.2` | Public domain | 248 features. Simplified to a small-scale TopoJSON at build time. |
| Indian states and UTs | geoBoundaries gbOpen `IND/ADM1`, commit `9469f09` (built 2023-12-12), derived from DataMeet India community and Election Commission of India data | CC BY 2.5 India (attribution required) | 36 units, current administrative structure: Ladakh separate from Jammu and Kashmir (2019), Dadra and Nagar Haveli and Daman and Diu merged (2020), Telangana present. |

Verified properties of the India layer before adoption: exactly 36 units; Ladakh extends to 37.08°N / 72.53°E and
to 80.33°E, and Jammu and Kashmir to 73.39°E, i.e. the layer follows India's official depiction of its boundaries.

**Why the India point of view for the world map.** Natural Earth's default countries layer shows de facto control,
which gives a different shape of Jammu and Kashmir and Ladakh than the India layer. Using the India worldview keeps
both maps consistent and matches the official depiction expected for an audience in India. This is a deliberate,
documented choice. Boundaries are shown for navigation only, are not authoritative and do not imply any position
on disputed territory. A different worldview can be produced by changing one constant in the build script.

**Corrections applied at build time (both recorded in the script):**

- geoBoundaries still uses four ISO 3166-2:IN codes that ISO replaced in 2023: `IN-CT`→`IN-CG` (Chhattisgarh),
  `IN-OR`→`IN-OD` (Odisha), `IN-TG`→`IN-TS` (Telangana), `IN-UT`→`IN-UK` (Uttarakhand). The map uses the current
  codes.
- Display names come from the app's registry of the 36 units (common English official names), not from the source's
  transliterated names (for example "Bihār" becomes "Bihar"). The build fails if the codes in the layer and the
  registry differ.
- Countries whose Natural Earth `ISO_A3` is `-99` use `ISO_A3_EH` (France, Norway). Units with no ISO code (for
  example Bir Tawil) keep their Natural Earth `ADM0_A3` id and are shown as "No ISO 3166 code".

**CRS.** Both sources are geographic coordinates on WGS 84 (EPSG:4326), longitude/latitude in degrees. TopoJSON
quantisation keeps them in degrees; projection happens only in the browser. Observation coordinates use the same CRS.

**Build and update.** `npm run build:geo` (`frontend/scripts/build-geo.mjs`) downloads the two pinned files, checks
their SHA-256, and simplifies them with mapshaper 0.7.72 run through npx, so it is not a project dependency. The
steps are:

- Explode multi-part features first, so `keep-shapes` protects every island and not just a feature's largest ring
  (otherwise Lakshadweep keeps only Minicoy).
- Simplify with a distance tolerance rather than a vertex percentage. A percentage collapsed the main Andaman ring
  to five vertices.
  - World: 6 km for parts under 10,000 km² and 20 km for larger landmasses. Parts under 150 km² are dropped, but
    each country keeps its largest part.
  - India: 1 km, with every island kept.
- Dissolve back, apply the corrections, and write `frontend/src/data/geo/*.topo.json` plus `sources.json`
  (provenance, shown on the Methodology page).

The output is 202 kB (70 kB gzip) for the world and 139 kB (49 kB gzip) for India. Both are lazy, content-hashed
chunks.

`backend/tests/test_geography.py` decodes the shipped TopoJSON. It checks that every Indian observation point lies
inside its own state or UT and inside no other, and that every catalog country exists on the world map with its
point inside it. A coastal point may sit up to 0.15° offshore because of the 20 km generalisation. Kavaratti is
exempt, since its island is below the world layer's resolution.

To update: bump the pinned source and hash, run the script, review the diff and run both test suites. Expected
cadence: after an administrative change in India, or yearly.

## 5. Analysis semantics: what the map may claim

The existing APIs analyse **one point**: the Open-Meteo reanalysis grid cell nearest a coordinate. No endpoint
computes an area average. Therefore:

1. **Observation locations.** The backend publishes a curated catalog of observation locations. Each has a name,
   coordinates, country (ISO 3166-1 alpha-3) and, in India, a state/UT code (ISO 3166-2:IN). India has one location
   for each of the 36 states and UTs. It is the capital when the capital lies in that state or UT. Punjab and
   Haryana share Chandigarh, which is a separate UT, so they use Ludhiana and Hisar, marked "major city". The four
   existing preset cities use exactly the same coordinates, so their cached data is reused. A further 27 locations
   cover other countries.
2. **Every metric is location-level.** Values appear on point markers and in panels titled with the location
   ("Jaipur — observation location"), never as the value of a country or state. Panels for a state say
   "Capital-city observation point, not a state-wide average" (or "major city" where that applies).
3. **Polygons encode coverage, never climate values.** Country and state fills show only: *stored data* (the
   catalog location's baseline and window are already in the database), *location available, not downloaded yet*,
   or *no supported location* (countries only). A state is never coloured by its city's heatwave count.
4. **Markers encode the selected indicator** once that location has been analysed in this session. Locations that
   have not been analysed have hollow markers. Nothing is fetched just because a page or map was opened.
5. **No data is shown honestly.** A country with no catalog location says "No supported observation location in
   <country> yet" and offers the custom-coordinate analysis. A failed analysis says so. Missing values are never
   drawn as zero.
6. **Indicators** (all from existing responses): heatwave events in the period, heatwave days per complete year,
   mean event duration, longest event, mean temperature anomaly (complete years) and the heatwave-day trend per
   decade with its classification. A **temperature trend** (a slope of annual anomalies) is not computed by any
   endpoint. It is listed in the selector as unavailable rather than estimated in the browser.
7. **Comparison labelling.** The state comparison compares the states' observation locations and says so in its
   title, cards and CSV ("scope: observation location, not state aggregate").

### Future state-level aggregation (not implemented)

A state-wide metric would need, at minimum:

- a sampling design: a regular grid at the reanalysis resolution (ERA5-Land 0.1°) clipped to the state polygon, or
  a stratified sample with documented weights;
- weights: area weights (cos latitude × cell fraction inside the polygon) for climate state, population weights for
  exposure, never mixed in one number;
- the metric computed **per cell, then aggregated**: a heatwave is a per-location exceedance of a local threshold,
  so averaging temperatures first and detecting heatwaves afterwards gives a different and wrong quantity;
- coverage rules: a minimum fraction of cells with a valid baseline and year (for example 90%), else no value;
- metadata on every value: cell count, weights, coverage, method version;
- separately named endpoints (for example `/api/analytics/regions/{code}/heatwaves`) so point and area results
  can never be confused.

A cell count of a few hundred per large state would multiply upstream ingestion. It therefore needs explicit approval
and an ingestion budget before it is built.

## 6. Backend contracts (10E)

Both endpoints are read-only, never call Open-Meteo, are validated, use the general rate-limit bucket (60/min per IP)
and return the standard error envelope.

`GET /api/geography/locations[?country=IND][&region=IN-RJ]`

```json
{
  "scope": "observation_location",
  "scope_note": "Each location is the reanalysis grid cell nearest its coordinates. Values are not country or state aggregates.",
  "count": 1,
  "locations": [
    {"id": "in-rj-jaipur", "name": "Jaipur", "latitude": 26.9124, "longitude": 75.7873,
     "country_code": "IND", "country_name": "India", "region_code": "IN-RJ", "region_name": "Rajasthan",
     "role": "capital", "role_note": null}
  ]
}
```

`country` must match `^[A-Z]{3}$`, `region` `^IN-[A-Z]{2}$` and be one of the 36 codes (else `422`). A valid
country with no locations returns an empty list (an honest "no supported location", not an error).

`GET /api/geography/coverage?start_date&end_date[&country][&region]`

For each matching catalog location: stored valid days in the baseline (1991 to 2020) and in the window, the expected
days, and `status`: `stored` (both ranges complete in the database, so an analysis runs without upstream downloads),
`partial`, or `not_stored`. One aggregation over `weather_records` with `$in` on `location_key` and a date range.
The `(location_key, date)` index covers it, and it has `maxTimeMS` 5000 (a timeout maps to the existing 503
handler). Date rules match the analysis endpoints. This says nothing about whether the values are valid. Validity is
still decided by the analysis endpoints' coverage rules.

Not added: `/api/geography/countries` and `/api/geography/india/states`. Boundary metadata is static and ships with
the boundary files. A second copy in the API would only add a source of drift. The backend keeps the 36-code
registry only to validate requests and the catalog.

## 7. Performance (10H)

- Map pages, d3 and the boundary files are lazy chunks. Boundary files are content-hashed, so the browser caches them
  immutably, and they are loaded once per session (memoised promise).
- Projected path strings are computed once per boundary set and size (`useMemo`). Hover changes only an overlay path
  and the tooltip, not the 250 polygons. `React.memo` covers the polygon layer.
- Catalog: fetched once per session. Coverage: one request per (range, scope), refetched only after an analysis
  finishes. Analyses: a session cache keyed by coordinates and range, shared by all pages, so opening the same state
  in the explorer and the comparison does not refetch. Superseded requests are aborted.
- Search is local (no network) and debounced (150 ms) only for the result list announcement.
- No ingestion on page load. The only calls that can trigger upstream downloads are the existing analysis endpoints,
  started by an explicit "Analyze" or "Compare" action and still subject to the 20/min limit.

## 8. Testing (10I)

Frontend (Vitest + Testing Library, jsdom): world and India map render the expected feature counts; hover tooltip;
click and keyboard selection; search; indicator change recolours markers; no-data country; coverage/API failure
states; state comparison controls (2 to 4, search, clear, per-state errors, CSV content and formula-injection
escaping); router; navigation; boundary data integrity (36 codes match the registry; every Indian observation point
lies inside its state polygon; ISO codes). Accessibility: roles and names, keyboard path, live regions; the existing
axe browser check extended to the new routes.

Backend (pytest): catalog integrity (36 regions, unique ids, coordinates in range, presets identical); locations
filtering and validation; coverage status maths against a throwaway local database; no upstream calls; rate-limit
bucket; error envelope; Atlas guard.

Regression: the existing suites are run unchanged for heatwave, anomaly and city comparison output.

## 9. Subphases

1. **10A**: this document; geo build script and data; test-safety guard.
2. **10E (moved forward)**: backend catalog and the two endpoints, because the UI depends on the contract.
3. **App shell**: router, navigation, theme toggle, Methodology and Anomalies pages.
4. **10B**: `GeoMap` and Global Explorer.
5. **10C**: India Explorer.
6. **10D**: State comparison (grouped bars, CSV).
7. **10F**: tests, browser check, documentation.

## 10. Decisions to revisit

- World map worldview (India point of view, section 4).
- Choice of observation point per state/UT. The capital is used where it lies inside the territory. Jammu and
  Kashmir uses Srinagar (summer capital) and Uttarakhand uses Dehradun. Andhra Pradesh uses Amaravati. Andaman and
  Nicobar Islands uses Sri Vijaya Puram (renamed from Port Blair in 2024).
- Single-cell caveat for coastal and island points (Mumbai, Kavaratti, Sri Vijaya Puram): the nearest reanalysis cell
  may be partly sea. This is the existing caveat, and it is now shown in their panels.

### Confirmed for Phase 10 (10G)

- The India point-of-view world boundaries stay, with the disputed-boundary notice shown on the map pages and in the methodology.
- One observation location per state/UT stays. Every result is labelled location-level, never state-wide.
- Temperature trend stays unavailable: no backend calculation exists, and no value is ever invented.
