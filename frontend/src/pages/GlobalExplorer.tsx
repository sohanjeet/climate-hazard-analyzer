import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Globe2, RotateCw } from 'lucide-react'
import { ExplorerControls, LocationCard, MapLegend, ScopeNotice } from '@/components/explore/ExplorerParts'
import { coverageDetail } from '@/lib/geo/coverage'
import { GeoMap, type MapMarker } from '@/components/map/GeoMap'
import { PlaceSearch } from '@/components/map/PlaceSearch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorldBoundaries } from '@/hooks/useGeography'
import type { ObservationLocation } from '@/lib/api/types'
import type { CityResult } from '@/lib/comparison'
import type { CountryFeature } from '@/lib/geo/boundaries'
import { formatIndicator, indicatorById } from '@/lib/geo/indicators'
import { Link } from '@/components/Link'
import { CatalogStatus } from '@/pages/CatalogStatus'
import { PageHeader } from '@/pages/PageHeader'
import { useExplorer, type ExplorerState, type GeoPageProps } from '@/pages/useExplorer'

const TrendCharts = lazy(() => import('@/pages/TrendCharts').then((m) => ({ default: m.TrendCharts })))

/**
 * "Analyse all" is offered only for a few locations: a country with dozens (India) would mean dozens of possibly
 * cold downloads and would run into the 20-per-minute analysis limit. Those get a compact list instead.
 */
const MAX_BATCH = 4

const COVERAGE_LEGEND = [
  { label: 'Observation location with stored data', color: 'var(--map-stored)' },
  { label: 'Observation location, data not downloaded yet', color: 'var(--map-available)' },
  { label: 'No supported observation location', color: 'var(--map-none)' },
]

export default function GlobalExplorer(props: GeoPageProps) {
  const ex = useExplorer(props, {})
  const [boundaries, retryBoundaries] = useWorldBoundaries()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  const def = indicatorById(ex.indicator)
  const { allLocations, valueFor, scale, coverageFor } = ex

  const countries = useMemo(() => (boundaries.status === 'success' ? boundaries.data : []), [boundaries])
  const byIso3 = useMemo(() => {
    const map = new Map<string, ObservationLocation[]>()
    for (const location of allLocations) map.set(location.country_code, [...(map.get(location.country_code) ?? []), location])
    return map
  }, [allLocations])
  const countryByIso3 = useMemo(() => new Map(countries.filter((c) => c.iso3).map((c) => [c.iso3!, c])), [countries])
  const locationsOf = useCallback((c: CountryFeature) => (c.iso3 ? byIso3.get(c.iso3) ?? [] : []), [byIso3])
  const selected = useMemo(() => countries.find((c) => c.id === selectedId) ?? null, [countries, selectedId])
  const selectedLocations = selected ? locationsOf(selected) : []
  const selectedIso3 = selected?.iso3 ?? null

  const fillFor = useCallback(
    (c: CountryFeature) => {
      const locations = locationsOf(c)
      if (locations.length === 0) return 'var(--map-none)'
      return locations.some((l) => coverageFor(l)?.status === 'stored') ? 'var(--map-stored)' : 'var(--map-available)'
    },
    [locationsOf, coverageFor],
  )
  const describe = useCallback(
    (c: CountryFeature) => {
      const n = locationsOf(c).length
      return n === 0 ? `${c.name}: no supported observation location` : `${c.name}: ${n} observation location${n === 1 ? '' : 's'}`
    },
    [locationsOf],
  )
  const tooltip = useCallback(
    (c: CountryFeature) => {
      const locations = locationsOf(c)
      return (
        <div>
          <p className="font-semibold">
            {c.name} <span className="font-normal text-muted-foreground">{c.iso3 ? `${c.iso2 ?? ''} · ${c.iso3}` : 'No ISO 3166 code'}</span>
          </p>
          {locations.length === 0 ? (
            <p className="text-muted-foreground">No supported observation location</p>
          ) : (
            <ul className="mt-1">
              {locations.map((l) => {
                const v = valueFor(l)
                return (
                  <li key={l.id} className="tabular">
                    {l.name}: {v.kind === 'value' ? `${formatIndicator(def, v.value)} ${def.unit}` : v.kind === 'empty' ? 'no value' : 'not analysed yet'}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )
    },
    [locationsOf, valueFor, def],
  )

  const markers = useMemo<MapMarker[]>(
    () =>
      allLocations.map((l) => {
        const v = valueFor(l)
        return {
          id: l.id,
          longitude: l.longitude,
          latitude: l.latitude,
          label: `${l.name}, ${l.country_name}: ${v.kind === 'value' ? `${formatIndicator(def, v.value)} ${def.unit} (location-level)` : 'not analysed yet'}`,
          fill: v.kind === 'value' && scale ? scale.colorFor(v.value) : null,
          emphasised: selectedIso3 === l.country_code,
        }
      }),
    [allLocations, valueFor, scale, def, selectedIso3],
  )

  function select(id: string | null, zoom = false) {
    setSelectedId(id)
    if (id && zoom) setFocusRequest({ id, nonce: Date.now() })
  }

  const analysedInSelection = selectedLocations.map((l) => ex.resultFor(l)).filter((r): r is CityResult => Boolean(r))
  const countriesWithLocations = byIso3.size

  return (
    <div>
      <PageHeader title="Global Climate Explorer" icon={Globe2}>
        Explore heatwaves and temperature anomalies at supported observation locations around the world. Select a country to see its
        locations and analyse them on demand; nothing downloads until you ask.
      </PageHeader>

      <div className="mt-8 flex flex-col gap-4">
        <ExplorerControls years={ex.years} onYearsChange={ex.setYears} indicator={ex.indicator} onIndicatorChange={ex.setIndicator} problem={ex.problem} now={props.now}>
          <PlaceSearch
            items={countries.map((c) => ({ ...c, codes: [c.iso2, c.iso3] }))}
            label="Find a country"
            placeholder="Country name or ISO code"
            meta={(c) => (c.iso3 ? `${c.iso3} · ${locationsOf(c).length} location${locationsOf(c).length === 1 ? '' : 's'}` : null)}
            onPick={(c) => select(c.id, true)}
            disabled={countries.length === 0}
          />
        </ExplorerControls>
        <ScopeNotice area="country" />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="world-map-heading" className="flex min-w-0 flex-col gap-4 rounded-lg border bg-surface p-3 sm:p-4">
          <h2 id="world-map-heading" className="sr-only">World map</h2>
          {boundaries.status === 'loading' ? <Skeleton className="aspect-[960/470] w-full" /> : null}
          {boundaries.status === 'error' ? (
            <Alert variant="danger" icon={<AlertTriangle aria-hidden="true" />} role="alert">
              <AlertTitle>The world map could not be loaded</AlertTitle>
              <AlertDescription>
                <Button type="button" variant="outline" size="sm" onClick={retryBoundaries}><RotateCw aria-hidden="true" />Try again</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {boundaries.status === 'success' ? (
            <GeoMap
              kind="world"
              features={countries}
              label="World map of countries"
              fillFor={fillFor}
              describe={describe}
              tooltip={tooltip}
              selectedId={selectedId}
              onSelect={(id) => select(id)}
              markers={markers}
              onMarkerSelect={(id) => {
                const location = ex.allLocations.find((l) => l.id === id)
                const country = location ? countryByIso3.get(location.country_code) : undefined
                if (country) select(country.id)
              }}
              focusRequest={focusRequest}
            />
          ) : null}
          <CatalogStatus ex={ex} />
          <MapLegend coverage={COVERAGE_LEGEND} indicator={ex.indicator} scale={ex.scale} analysedCount={ex.analysedValues.length} />
          <p className="text-xs text-muted-foreground">
            Boundaries: Natural Earth (public domain), India point of view; shown for navigation only and without any position on disputed
            territory. Coastlines are generalised by up to about 20 km, and islands under 150 km² are omitted at this scale.
          </p>
        </section>

        <aside aria-label="Country details" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20">
          <p role="status" className="sr-only">{selected ? `${selected.name} selected. ${selectedLocations.length} observation location${selectedLocations.length === 1 ? '' : 's'}.` : ''}</p>
          {selected ? (
            <>
              <div className="rounded-lg border bg-surface p-4">
                <h2 className="text-xl font-semibold tracking-tight">{selected.name}</h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">ISO code</dt>
                  <dd className="tabular">{selected.iso3 ? `${selected.iso2 ?? '—'} / ${selected.iso3}` : 'No ISO 3166 code'}</dd>
                  <dt className="text-muted-foreground">Observation locations</dt>
                  <dd className="tabular">{selectedLocations.length}</dd>
                </dl>
                <Button type="button" variant="link" className="mt-2" onClick={() => select(null)}>Clear selection</Button>
              </div>
              {selectedLocations.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm" data-testid="no-data-country">
                  <h3 className="font-semibold">No supported observation location in {selected.name} yet</h3>
                  <p className="mt-1 text-muted-foreground">
                    Country-wide statistics are not shown anywhere in this app: they would need an area method with many sampled points (see
                    the <Link to="/methodology" className="text-primary underline underline-offset-4">methodology</Link>). You can analyse any coordinates on
                    the <Link to="/" className="text-primary underline underline-offset-4">dashboard</Link>.
                  </p>
                </div>
              ) : (
                <>
                  {selectedLocations.length > 1 && selectedLocations.length <= MAX_BATCH ? (
                    <Button type="button" variant="outline" onClick={() => ex.analyze(selectedLocations)} disabled={Boolean(ex.problem)}>
                      Analyse all {selectedLocations.length} locations
                    </Button>
                  ) : null}
                  {selectedLocations.length > MAX_BATCH ? (
                    <CompactLocationList
                      ex={ex}
                      locations={selectedLocations}
                      country={selected.name}
                      explorer={selected.iso3 === 'IND' ? '/explore/india' : null}
                    />
                  ) : (
                    selectedLocations.map((l) => (
                      <LocationCard
                        key={l.id}
                        location={l}
                        result={ex.resultFor(l)}
                        coverage={ex.coverageFor(l)}
                        indicator={ex.indicator}
                        onAnalyze={() => ex.analyze([l])}
                        busy={false}
                        disabledReason={ex.problem ? 'Fix the period first.' : null}
                        scopeLabel={`Observation location in ${selected.name}, not a national average`}
                      />
                    ))
                  )}
                </>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-5 text-sm">
              <h2 className="text-base font-semibold">Select a country</h2>
              <p className="mt-1 text-muted-foreground">
                Click a country, use the search, or focus the map and use the arrow keys. {countriesWithLocations > 0 ? `${countriesWithLocations} countries have supported observation locations (${ex.allLocations.length} in total).` : ''}
              </p>
            </div>
          )}
        </aside>
      </div>

      <section aria-labelledby="global-trends" className="mt-14">
        <h2 id="global-trends" className="text-xl font-semibold tracking-tight">Trend over time</h2>
        <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
          Year-by-year values for the analysed locations in {selected ? selected.name : 'the selected country'}. Each line is one location.
        </p>
        <div className="mt-6">
          {analysedInSelection.length > 0 ? (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <TrendCharts cities={analysedInSelection.slice(0, 4)} indicator={ex.indicator} />
            </Suspense>
          ) : (
            <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {selected ? 'Analyse a location in this country to see its years.' : 'Select a country and analyse one of its locations.'}
            </p>
          )}
        </div>
      </section>

      <LocationsTable ex={ex} onShow={(l) => {
        const country = countryByIso3.get(l.country_code)
        if (country) select(country.id, true)
      }} />

      <section aria-labelledby="global-quality" className="mt-14 max-w-prose">
        <h2 id="global-quality" className="text-xl font-semibold tracking-tight">About these data</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[0.9375rem] text-muted-foreground">
          <li>Each value comes from the Open-Meteo historical archive for the single reanalysis grid cell nearest a location. It is not a station record and not an area average.</li>
          <li>Heatwaves and anomalies are measured against each location’s own 1991–2020 baseline, so a value compares the location with its own past, not with other places’ temperatures.</li>
          <li>Only complete calendar years enter per-year values and trends. Missing days are never filled in. A dash means no comparable value, never zero.</li>
          <li>Coastal points can fall in a grid cell that is partly sea, which damps extremes.</li>
        </ul>
      </section>
    </div>
  )
}

function LocationsTable({ ex, onShow }: { ex: ReturnType<typeof useExplorer>; onShow: (l: ObservationLocation) => void }) {
  const def = indicatorById(ex.indicator)
  const rows = [...ex.allLocations].sort((a, b) => a.country_name.localeCompare(b.country_name) || a.name.localeCompare(b.name))
  return (
    <section aria-labelledby="global-locations" className="mt-14">
      <h2 id="global-locations" className="text-xl font-semibold tracking-tight">Available observation locations</h2>
      <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">Every supported location. Values are for one location each, for the chosen period.</p>
      <div className="relative mt-4 max-h-[28rem] overflow-auto rounded-lg border">
        <table className="tabular w-full text-left text-sm">
          <caption className="sr-only">Observation locations with data availability and {def.label}</caption>
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Country</th>
              <th scope="col" className="px-3 py-2 font-semibold">Location</th>
              <th scope="col" className="px-3 py-2 font-semibold">Data</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">{def.label} ({def.unit})</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((l) => {
              const v = ex.valueFor(l)
              const coverage = ex.coverageFor(l)
              return (
                <tr key={l.id}>
                  <td className="px-3 py-1.5">{l.region_name ? `${l.country_name} · ${l.region_name}` : l.country_name}</td>
                  <th scope="row" className="px-3 py-1.5 font-medium">{l.name}</th>
                  <td className="px-3 py-1.5 text-muted-foreground" title={coverageDetail(coverage) ?? undefined}>
                    {coverage ? { stored: 'Stored', partial: 'Partly stored', not_stored: 'Not downloaded' }[coverage.status] : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {v.kind === 'value' ? formatIndicator(def, v.value) : v.kind === 'loading' ? 'Loading…' : v.kind === 'error' ? 'Failed' : v.kind === 'empty' ? <span title={v.reason}>—</span> : <span className="text-muted-foreground">Not analysed</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button type="button" variant="link" size="sm" onClick={() => onShow(l)} aria-label={`Show ${l.name} on the map`}>Show</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CompactLocationList({ ex, locations, country, explorer }: { ex: ExplorerState; locations: readonly ObservationLocation[]; country: string; explorer: string | null }) {
  const def = indicatorById(ex.indicator)
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-surface p-4 text-sm">
      <p className="text-muted-foreground">
        {locations.length} observation locations in {country}, each analysed separately (none is a national average).
        {explorer ? (
          <>
            {' '}For maps, summaries and comparisons by state, use the <Link to={explorer} className="font-semibold text-primary underline underline-offset-4">India Explorer</Link>.
          </>
        ) : null}
      </p>
      <ul aria-label={`Observation locations in ${country}`} className="-mx-1 flex max-h-[28rem] flex-col divide-y overflow-auto px-1">
        {locations.map((l) => {
          const v = ex.valueFor(l)
          const busy = v.kind === 'loading'
          return (
            <li key={l.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{l.region_name ?? l.country_name}</span>
              </span>
              {v.kind === 'value' ? (
                <span className="tabular shrink-0">{formatIndicator(def, v.value)} <span className="text-muted-foreground">{def.unit}</span></span>
              ) : v.kind === 'empty' ? (
                <span className="shrink-0 text-muted-foreground" title={v.reason}>—<span className="sr-only"> {v.reason}</span></span>
              ) : (
                <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={busy || Boolean(ex.problem)} onClick={() => ex.analyze([l])}
                  aria-label={`${busy ? 'Analysing' : v.kind === 'error' ? 'Retry' : 'Analyse'} ${l.name}`}>
                  {busy ? 'Analysing…' : v.kind === 'error' ? 'Retry' : 'Analyse'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
