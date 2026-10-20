import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Map as MapIcon, RotateCw } from 'lucide-react'
import { ExplorerControls, LocationCard, MapLegend, ScopeNotice } from '@/components/explore/ExplorerParts'
import { coverageDetail } from '@/lib/geo/coverage'
import { GeoMap, type MapMarker } from '@/components/map/GeoMap'
import { PlaceSearch } from '@/components/map/PlaceSearch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useIndiaBoundaries } from '@/hooks/useGeography'
import type { ObservationLocation } from '@/lib/api/types'
import type { CityResult } from '@/lib/comparison'
import type { RegionFeature } from '@/lib/geo/boundaries'
import { formatIndicator, indicatorById } from '@/lib/geo/indicators'
import { INDIA_REGIONS, REGION_TYPE_LABEL, regionScopeLabel } from '@/lib/geo/regions'
import { CatalogStatus } from '@/pages/CatalogStatus'
import { PageHeader } from '@/pages/PageHeader'
import { useExplorer, type GeoPageProps } from '@/pages/useExplorer'

const TrendCharts = lazy(() => import('@/pages/TrendCharts').then((m) => ({ default: m.TrendCharts })))
const IndicatorBarChart = lazy(() => import('@/components/explore/IndicatorBarChart').then((m) => ({ default: m.IndicatorBarChart })))

const COVERAGE_LEGEND = [
  { label: 'Observation location with stored data', color: 'var(--map-stored)' },
  { label: 'Observation location, data not downloaded yet', color: 'var(--map-available)' },
]

export default function IndiaExplorer(props: GeoPageProps) {
  const ex = useExplorer(props, { country: 'IND' })
  const [boundaries, retryBoundaries] = useIndiaBoundaries()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  const def = indicatorById(ex.indicator)
  const { allLocations, valueFor, scale, coverageFor } = ex

  const regions = useMemo(() => (boundaries.status === 'success' ? boundaries.data : []), [boundaries])
  const byRegion = useMemo(() => {
    const map = new Map<string, ObservationLocation[]>()
    for (const l of allLocations) if (l.region_code) map.set(l.region_code, [...(map.get(l.region_code) ?? []), l])
    return map
  }, [allLocations])
  const locationsOf = useCallback((id: string) => byRegion.get(id) ?? [], [byRegion])
  const selected = regions.find((r) => r.id === selectedId) ?? null
  const selectedLocations = selected ? locationsOf(selected.id) : []

  const fillFor = useCallback(
    (r: RegionFeature) => {
      const locations = locationsOf(r.id)
      if (locations.length === 0) return 'var(--map-none)'
      return locations.some((l) => coverageFor(l)?.status === 'stored') ? 'var(--map-stored)' : 'var(--map-available)'
    },
    [locationsOf, coverageFor],
  )
  const describe = useCallback(
    (r: RegionFeature) => {
      const l = locationsOf(r.id)[0]
      return `${r.name}, ${REGION_TYPE_LABEL[r.type].toLowerCase()}${l ? `; observation location ${l.name}` : ''}`
    },
    [locationsOf],
  )
  const tooltip = useCallback(
    (r: RegionFeature) => (
      <div>
        <p className="font-semibold">
          {r.name} <span className="font-normal text-muted-foreground">{r.id}</span>
        </p>
        <p className="text-muted-foreground">{REGION_TYPE_LABEL[r.type]}</p>
        {locationsOf(r.id).map((l) => {
          const v = valueFor(l)
          return (
            <p key={l.id} className="tabular mt-1">
              {l.name}: {v.kind === 'value' ? `${formatIndicator(def, v.value)} ${def.unit}` : v.kind === 'empty' ? 'no value' : 'not analysed yet'}
            </p>
          )
        })}
      </div>
    ),
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
          label: `${l.name} (${l.region_name}): ${v.kind === 'value' ? `${formatIndicator(def, v.value)} ${def.unit}, location-level` : 'not analysed yet'}`,
          fill: v.kind === 'value' && scale ? scale.colorFor(v.value) : null,
          emphasised: l.region_code === selectedId,
        }
      }),
    [allLocations, valueFor, scale, def, selectedId],
  )

  function select(id: string | null, zoom = false) {
    setSelectedId(id)
    if (id && zoom) setFocusRequest({ id, nonce: Date.now() })
  }

  const storedCount = ex.allLocations.filter((l) => ex.coverageFor(l)?.status === 'stored').length
  const ranked = [...ex.analysedValues].sort((a, b) => b.value - a.value)
  const analysedCities = ex.allLocations.map((l) => ex.resultFor(l)).filter((r): r is CityResult => Boolean(r))
  const selectedResults = selectedLocations.map((l) => ex.resultFor(l)).filter((r): r is CityResult => Boolean(r))
  const stateCount = INDIA_REGIONS.filter((r) => r.type === 'state').length

  return (
    <div>
      <PageHeader title="India Climate Explorer" icon={MapIcon}>
        All {stateCount} states and {INDIA_REGIONS.length - stateCount} union territories, each with one observation location. Select a state to
        see its location, analyse it on demand, and compare the analysed locations below.
      </PageHeader>

      <div className="mt-8 flex flex-col gap-4">
        <ExplorerControls years={ex.years} onYearsChange={ex.setYears} indicator={ex.indicator} onIndicatorChange={ex.setIndicator} problem={ex.problem} now={props.now}>
          <PlaceSearch
            items={regions.map((r) => ({ ...r, codes: [r.id, r.id.slice(3)] }))}
            label="Find a state or union territory"
            placeholder="Name or code, e.g. Kerala or IN-KL"
            meta={(r) => r.id}
            onPick={(r) => select(r.id, true)}
            disabled={regions.length === 0}
          />
        </ExplorerControls>
        <ScopeNotice area="state" />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="india-map-heading" className="flex min-w-0 flex-col gap-4 rounded-lg border bg-surface p-3 sm:p-4">
          <h2 id="india-map-heading" className="sr-only">India map</h2>
          {boundaries.status === 'loading' ? <Skeleton className="mx-auto aspect-[800/860] w-full max-w-[44rem]" /> : null}
          {boundaries.status === 'error' ? (
            <Alert variant="danger" icon={<AlertTriangle aria-hidden="true" />} role="alert">
              <AlertTitle>The India map could not be loaded</AlertTitle>
              <AlertDescription>
                <Button type="button" variant="outline" size="sm" onClick={retryBoundaries}><RotateCw aria-hidden="true" />Try again</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {boundaries.status === 'success' ? (
            <div className="mx-auto w-full max-w-[44rem]">
              <GeoMap
                kind="india"
                features={regions}
                label="Map of Indian states and union territories"
                fillFor={fillFor}
                describe={describe}
                tooltip={tooltip}
                selectedId={selectedId}
                onSelect={(id) => select(id)}
                markers={markers}
                onMarkerSelect={(id) => {
                  const region = ex.allLocations.find((l) => l.id === id)?.region_code
                  if (region) select(region)
                }}
                focusRequest={focusRequest}
              />
            </div>
          ) : null}
          <CatalogStatus ex={ex} />
          <MapLegend coverage={COVERAGE_LEGEND} indicator={ex.indicator} scale={ex.scale} analysedCount={ex.analysedValues.length} />
          <p className="text-xs text-muted-foreground">
            Boundaries: geoBoundaries IND ADM1 (DataMeet India community, Election Commission of India; CC BY 2.5 IN), current administrative
            structure, simplified to about 1 km. Shown for navigation only; not an authoritative survey boundary.
          </p>
        </section>

        <aside aria-label="State details" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20">
          <p role="status" className="sr-only">{selected ? `${selected.name} selected.` : ''}</p>
          {selected ? (
            <>
              <div className="rounded-lg border bg-surface p-4">
                <h2 className="text-xl font-semibold tracking-tight">{selected.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{REGION_TYPE_LABEL[selected.type]} · {selected.id}</p>
                <Button type="button" variant="link" className="mt-2" onClick={() => select(null)}>Clear selection</Button>
              </div>
              {selectedLocations.map((l) => (
                <LocationCard
                  key={l.id}
                  location={l}
                  result={ex.resultFor(l)}
                  coverage={ex.coverageFor(l)}
                  indicator={ex.indicator}
                  onAnalyze={() => ex.analyze([l])}
                  busy={false}
                  disabledReason={ex.problem ? 'Fix the period first.' : null}
                  scopeLabel={regionScopeLabel(l)}
                />
              ))}
              {selectedLocations.length === 0 && ex.catalog.status === 'success' ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No observation location is defined for {selected.name}.</p>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-5 text-sm">
              <h2 className="text-base font-semibold">Select a state or union territory</h2>
              <p className="mt-1 text-muted-foreground">Click the map, use the search, or focus the map and use the arrow keys or type a name.</p>
            </div>
          )}
        </aside>
      </div>

      <section aria-labelledby="india-summary" className="mt-14">
        <h2 id="india-summary" className="text-xl font-semibold tracking-tight">Regional summary</h2>
        <div className="@container mt-4">
          <dl className="grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-4">
            <SummaryCard term="States and union territories" detail={`${stateCount} states, ${INDIA_REGIONS.length - stateCount} union territories`}>{INDIA_REGIONS.length}</SummaryCard>
            <SummaryCard term="Locations with stored data" detail="Analyses for these run from the database in about a second.">
              {ex.coverage.status === 'success' ? `${storedCount} of ${ex.allLocations.length}` : '—'}
            </SummaryCard>
            <SummaryCard term={`Highest ${def.label.toLowerCase()}`} detail={ranked[0] ? `${ranked[0].location.name} (${ranked[0].location.region_name}); one location, among those analysed.` : 'Analyse locations to compare them.'}>
              {ranked[0] ? `${formatIndicator(def, ranked[0].value)} ${def.unit}` : '—'}
            </SummaryCard>
            <SummaryCard term={`Lowest ${def.label.toLowerCase()}`} detail={ranked.length > 1 ? `${ranked.at(-1)!.location.name} (${ranked.at(-1)!.location.region_name}); among ${ranked.length} analysed.` : 'Needs two analysed locations.'}>
              {ranked.length > 1 ? `${formatIndicator(def, ranked.at(-1)!.value)} ${def.unit}` : '—'}
            </SummaryCard>
          </dl>
        </div>
      </section>

      <section aria-labelledby="india-compare" className="mt-14">
        <h2 id="india-compare" className="text-xl font-semibold tracking-tight">Analysed locations compared</h2>
        <div className="mt-4 max-w-4xl">
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <IndicatorBarChart
              indicator={def}
              title={def.label}
              data={ex.analysedValues.map(({ location, value }) => ({ id: location.id, label: `${location.region_name} · ${location.name}`, value }))}
              caption={`One observation location per state or UT, for ${ex.years.startYear}–${ex.years.endYear}. Locations without a value (for example no heatwave events, so no duration) are left out, not drawn as zero. Not state-wide averages.`}
            />
          </Suspense>
        </div>
      </section>

      <section aria-labelledby="india-trends" className="mt-14">
        <h2 id="india-trends" className="text-xl font-semibold tracking-tight">Annual climate trends</h2>
        <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
          {selected ? `${selected.name}'s observation location${selectedResults.length === 0 ? ' once analysed' : ''}` : 'The first four analysed locations'}, year by year. For a side-by-side view of up to four states use the state comparison.
        </p>
        <div className="mt-6">
          {(selected ? selectedResults : analysedCities).length > 0 ? (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <TrendCharts cities={(selected ? selectedResults : analysedCities).slice(0, 4)} indicator={ex.indicator} />
            </Suspense>
          ) : (
            <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No analysed location to chart yet.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="india-availability" className="mt-14">
        <h2 id="india-availability" className="text-xl font-semibold tracking-tight">Data availability</h2>
        <div className="relative mt-4 max-h-[32rem] overflow-auto rounded-lg border">
          <table className="tabular w-full text-left text-sm">
            <caption className="sr-only">Observation location and data availability for every state and union territory</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">State or UT</th>
                <th scope="col" className="px-3 py-2 font-semibold">Observation location</th>
                <th scope="col" className="px-3 py-2 font-semibold">Stored data</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{def.label} ({def.unit})</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {INDIA_REGIONS.map((region) => {
                const l = locationsOf(region.code)[0]
                const coverage = l ? ex.coverageFor(l) : undefined
                const v = l ? ex.valueFor(l) : null
                return (
                  <tr key={region.code}>
                    <th scope="row" className="px-3 py-1.5 font-medium">
                      {region.name} <span className="font-normal text-muted-foreground">{region.type === 'union_territory' ? 'UT' : ''}</span>
                    </th>
                    <td className="px-3 py-1.5">{l ? `${l.name}${l.role === 'major_city' ? ' (major city)' : ''}` : '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground" title={coverageDetail(coverage) ?? undefined}>
                      {coverage ? `${Math.round((100 * (coverage.baseline_stored_days + coverage.window_stored_days)) / (coverage.baseline_expected_days + coverage.window_expected_days))}%` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {!v ? '—' : v.kind === 'value' ? formatIndicator(def, v.value) : v.kind === 'loading' ? 'Loading…' : v.kind === 'error' ? 'Failed' : v.kind === 'empty' ? <span title={v.reason}>—<span className="sr-only"> {v.reason}</span></span> : <span className="text-muted-foreground">Not analysed</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button type="button" variant="link" size="sm" onClick={() => select(region.code, true)} aria-label={`Show ${region.name} on the map`}>Show</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Stored data is the share of baseline (1991–2020) and period days already in the database for that location.</p>
      </section>
    </div>
  )
}

function SummaryCard({ term, detail, children }: { term: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-surface p-4">
      <dt className="text-sm font-medium text-muted-foreground">{term}</dt>
      <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{children}</dd>
      <dd className="mt-1 text-sm text-muted-foreground">{detail}</dd>
    </div>
  )
}
