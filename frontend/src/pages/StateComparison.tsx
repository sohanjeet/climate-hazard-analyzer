import { Suspense, lazy, useId, useMemo, useState } from 'react'
import { Download, GitCompareArrows, Loader2, X } from 'lucide-react'
import { CityStatusList, ComparisonCards, ComparisonTable, CoverageNotes } from '@/components/compare/ComparisonResults'
import { SeriesSwatch } from '@/components/compare/series'
import { ExplorerControls, ScopeNotice } from '@/components/explore/ExplorerParts'
import { PlaceSearch } from '@/components/map/PlaceSearch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useComparison } from '@/hooks/useComparison'
import { DEFAULT_GEOGRAPHY_API, useCoverage, useObservationLocations } from '@/hooks/useGeography'
import { useSlowHint } from '@/hooks/useSlowHint'
import type { ObservationLocation } from '@/lib/api/types'
import { MAX_LOCATIONS, MIN_LOCATIONS, buildCityMetrics, hasError, isLoading, locationId, type CityResult, type ComparisonLocation } from '@/lib/comparison'
import { buildComparisonCsv, downloadText } from '@/lib/csv'
import { CLASSIFICATION_LABEL, formatNumber, formatSigned } from '@/lib/format'
import { indicatorById, indicatorValue, type IndicatorId } from '@/lib/geo/indicators'
import { defaultYearRange, toDateRange, yearRangeProblem, type YearRange } from '@/lib/geo/period'
import { INDIA_REGIONS, regionByCode, regionScopeLabel } from '@/lib/geo/regions'
import { PageHeader } from '@/pages/PageHeader'
import { SHARED_FETCHERS, type GeoPageProps } from '@/pages/useExplorer'

const TrendCharts = lazy(() => import('@/pages/TrendCharts').then((m) => ({ default: m.TrendCharts })))
const GroupedBarChart = lazy(() => import('@/components/compare/GroupedBarChart').then((m) => ({ default: m.GroupedBarChart })))
const IndicatorBarChart = lazy(() => import('@/components/explore/IndicatorBarChart').then((m) => ({ default: m.IndicatorBarChart })))

interface Picked {
  code: string
  /** Stable colour/marker slot, kept while the state stays selected. */
  slot: number
}

const comparisonName = (location: ObservationLocation) => `${location.region_name} · ${location.name}`

export default function StateComparison({ fetchers = SHARED_FETCHERS, geography = DEFAULT_GEOGRAPHY_API, now }: GeoPageProps) {
  const uid = useId()
  const { state, run, retry, retryFailed, cancel } = useComparison(fetchers)
  const [catalog, retryCatalog] = useObservationLocations(geography)
  const slowCatalog = useSlowHint(catalog.status === 'loading')
  const [picked, setPicked] = useState<Picked[]>([])
  const [years, setYears] = useState<YearRange>(() => defaultYearRange(now))
  const [indicator, setIndicator] = useState<IndicatorId>('heatwave_days')
  const [notice, setNotice] = useState<string | null>(null)
  const problem = yearRangeProblem(years, now)

  const byRegion = useMemo(() => {
    const map = new Map<string, ObservationLocation>()
    if (catalog.status === 'success') for (const l of catalog.data.locations) if (l.region_code && !map.has(l.region_code)) map.set(l.region_code, l)
    return map
  }, [catalog])

  const busy = state.cities.some(isLoading)
  const finished = state.status === 'running' && !busy
  const failedCount = state.cities.filter(hasError).length
  const ran = state.status === 'running' ? state.range : null
  const [coverage] = useCoverage(geography, ran ? { ...ran, country: 'IND' } : null, finished ? 1 : 0)

  function add(code: string) {
    setNotice(null)
    if (picked.some((p) => p.code === code)) return
    if (picked.length >= MAX_LOCATIONS) {
      setNotice(`You can compare at most ${MAX_LOCATIONS} states. Remove one first.`)
      return
    }
    const used = new Set(picked.map((p) => p.slot))
    const slot = [0, 1, 2, 3].find((s) => !used.has(s))!
    setPicked([...picked, { code, slot }])
  }

  function compare(event: React.FormEvent) {
    event.preventDefault()
    if (busy || problem) return
    if (picked.length < MIN_LOCATIONS) {
      setNotice(`Select at least ${MIN_LOCATIONS} states to compare.`)
      return
    }
    const locations: ComparisonLocation[] = picked.flatMap(({ code, slot }) => {
      const l = byRegion.get(code)
      return l ? [{ id: locationId(l.latitude, l.longitude), name: comparisonName(l), latitude: l.latitude, longitude: l.longitude, slot }] : []
    })
    void run(locations, toDateRange(years))
  }

  const regionOfCity = (city: CityResult) =>
    [...byRegion.values()].find((l) => locationId(l.latitude, l.longitude) === city.location.id)
  const def = indicatorById(indicator)
  const announcement = busy
    ? `Comparing ${state.cities.length} states. ${state.cities.filter((c) => !isLoading(c)).length} finished.`
    : finished
      ? failedCount > 0 ? `Comparison finished. ${failedCount} of ${state.cities.length} states had errors.` : `Comparison complete for ${state.cities.length} states.`
      : ''

  return (
    <div>
      <PageHeader title="Compare states" icon={GitCompareArrows}>
        Put two to four Indian states or union territories side by side, each represented by its observation location. Same period and same
        method for every state.
      </PageHeader>

      <form noValidate onSubmit={compare} aria-label="State comparison controls" className="mt-8 flex flex-col gap-4">
        <ExplorerControls years={years} onYearsChange={setYears} indicator={indicator} onIndicatorChange={setIndicator} problem={problem} now={now}>
          <PlaceSearch
            items={INDIA_REGIONS.map((r) => ({ id: r.code, name: r.name, codes: [r.code, r.code.slice(3)] }))}
            label={`Add a state (${picked.length} of ${MAX_LOCATIONS})`}
            placeholder="Search states and union territories"
            meta={(r) => byRegion.get(r.id)?.name ?? r.id}
            isDisabled={(r) => (picked.some((p) => p.code === r.id) ? 'Selected' : picked.length >= MAX_LOCATIONS ? 'Limit reached' : null)}
            onPick={(r) => add(r.id)}
            disabled={busy}
          />
        </ExplorerControls>

        <div className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
          <h2 id={`${uid}-picked`} className="text-sm font-semibold">
            Selected states <span className="font-normal text-muted-foreground">({picked.length} of {MAX_LOCATIONS}; choose {MIN_LOCATIONS} to {MAX_LOCATIONS})</span>
          </h2>
          {picked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No state selected yet. Use the search above.</p>
          ) : (
            <ul aria-labelledby={`${uid}-picked`} className="flex flex-wrap gap-2">
              {picked.map(({ code, slot }) => {
                const region = regionByCode(code)!
                const l = byRegion.get(code)
                return (
                  <li key={code} className="flex items-center gap-2 rounded-md border py-1 pr-1 pl-2.5">
                    <SeriesSwatch slot={slot} />
                    <span className="text-sm">
                      <span className="font-medium">{region.name}</span>
                      {l ? <span className="text-muted-foreground"> · {l.name}</span> : null}
                    </span>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${region.name}`} disabled={busy}
                      onClick={() => { setNotice(null); setPicked(picked.filter((p) => p.code !== code)) }}>
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <div role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-danger-foreground">{notice}</div>
          {catalog.status === 'error' ? (
            <p role="alert" className="text-sm text-danger-foreground">
              Observation locations could not be loaded, so states cannot be compared yet.{' '}
              <button type="button" className="font-semibold underline underline-offset-4" onClick={retryCatalog}>Retry</button>
            </p>
          ) : null}
          {catalog.status === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading observation locations…
              {slowCatalog && ' The server may be waking up after a period of inactivity. This can take up to a minute on the first visit.'}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || catalog.status !== 'success'}>
              {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <GitCompareArrows aria-hidden="true" />}
              {busy ? 'Comparing…' : 'Compare states'}
            </Button>
            {busy ? (
              <Button type="button" variant="outline" onClick={cancel}><X aria-hidden="true" />Cancel</Button>
            ) : (
              <Button type="button" variant="outline" disabled={picked.length === 0} onClick={() => { setPicked([]); setNotice(null); cancel() }}>
                Clear selection
              </Button>
            )}
            <p className="text-sm text-muted-foreground">States are analysed two at a time; a location without stored data can take 5 to 45 seconds.</p>
          </div>
        </div>
        <ScopeNotice area="state" />
      </form>

      <div id="state-compare-results" className="mt-10 flex flex-col gap-14">
        <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
        {state.status === 'idle' ? (
          <section aria-labelledby={`${uid}-empty`} className="rounded-lg border border-dashed px-6 py-12 sm:px-10">
            <GitCompareArrows aria-hidden="true" className="size-8 text-heat" />
            <h2 id={`${uid}-empty`} className="mt-4 text-xl font-semibold tracking-tight">Choose two to four states to compare</h2>
            <p className="mt-2 max-w-prose text-[0.9375rem] text-muted-foreground">
              Each state is analysed at one observation location (usually its capital). The results compare those locations; they are not
              state-wide averages, and every card, chart and export says so.
            </p>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Results</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  <Badge variant="info">Scope: observation locations</Badge> {ran ? `${ran.startDate.slice(0, 4)}–${ran.endDate.slice(0, 4)}` : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!state.cities.some((c) => c.heatwave.status === 'success' || c.anomaly.status === 'success')}
                onClick={() => {
                  const csv = buildComparisonCsv(state.cities, (city) => {
                    const l = regionOfCity(city)
                    return { code: l?.region_code ?? '', name: l?.region_name ?? city.location.name }
                  })
                  downloadText(`state-comparison-${ran?.startDate.slice(0, 4)}-${ran?.endDate.slice(0, 4)}.csv`, csv)
                }}
              >
                <Download aria-hidden="true" />
                Download CSV
              </Button>
            </div>
            <CityStatusList cities={state.cities} onRetry={(id) => void retry(id)} onRetryFailed={() => void retryFailed()} />
            <p className="-mt-8 text-sm text-muted-foreground">
              {state.cities.map((c) => {
                const l = regionOfCity(c)
                return l ? `${l.region_name}: ${regionScopeLabel(l).toLowerCase()}` : null
              }).filter(Boolean).join('. ')}.
            </p>
            <ComparisonCards cities={state.cities} />
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <section aria-labelledby={`${uid}-ind`}>
                <h2 id={`${uid}-ind`} className="sr-only">{def.label} by state</h2>
                <IndicatorBarChart
                  indicator={def}
                  title={`${def.label} by state`}
                  data={state.cities.flatMap((c) => {
                    const v = indicatorValue(indicator, c)
                    return v.kind === 'value' ? [{ id: c.location.id, label: c.location.name, value: v.value }] : []
                  })}
                  caption="One observation location per state. States without a value for this indicator are left out, never drawn as zero."
                />
              </section>
            </Suspense>
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <section aria-labelledby={`${uid}-lines`}>
                <h2 id={`${uid}-lines`} className="text-xl font-semibold tracking-tight">Year by year</h2>
                <div className="mt-6"><TrendCharts cities={state.cities} indicator={indicator} keepSlots /></div>
              </section>
            </Suspense>
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <section aria-labelledby={`${uid}-events`} className="max-w-4xl">
                <h2 id={`${uid}-events`} className="sr-only">Heatwave event statistics</h2>
                <GroupedBarChart cities={state.cities} />
              </section>
            </Suspense>
            <AnnualTrends cities={state.cities} />
            <ComparisonTable cities={state.cities} />
            <section aria-labelledby={`${uid}-coverage`}>
              <h2 id={`${uid}-coverage`} className="text-xl font-semibold tracking-tight">Stored data</h2>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {state.cities.map((c) => {
                  const l = regionOfCity(c)
                  const row = l && coverage.status === 'success' ? coverage.data?.get(l.id) : undefined
                  return (
                    <li key={c.location.id} className="tabular">
                      <span className="font-medium">{c.location.name}:</span>{' '}
                      {row ? `${formatNumber(row.baseline_stored_days, 0)} of ${formatNumber(row.baseline_expected_days, 0)} baseline days and ${formatNumber(row.window_stored_days, 0)} of ${formatNumber(row.window_expected_days, 0)} period days stored` : coverage.status === 'error' ? 'coverage unavailable' : '—'}
                    </li>
                  )
                })}
              </ul>
            </section>
            <CoverageNotes cities={state.cities} />
          </>
        )}
      </div>
    </div>
  )
}

function AnnualTrends({ cities }: { cities: readonly CityResult[] }) {
  return (
    <section aria-labelledby="state-trends">
      <h2 id="state-trends" className="text-xl font-semibold tracking-tight">Annual trends</h2>
      <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
        Least-squares slope of heatwave days per complete year. A temperature trend is not computed by the API yet, so none is shown.
      </p>
      <div className="@container mt-4">
        <ul className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-4">
          {cities.map((c) => {
            const m = buildCityMetrics(c)
            return (
              <li key={c.location.id} className="rounded-lg border bg-surface p-4">
                <p className="flex items-center gap-2 font-semibold"><SeriesSwatch slot={c.location.slot} />{c.location.name}</p>
                {!m.hasHeatwave ? (
                  <p className="mt-2 text-sm text-muted-foreground">{c.heatwave.status === 'loading' ? 'Loading…' : 'Not loaded.'}</p>
                ) : m.heatwaveDayTrendClass === 'insufficient_data' || m.heatwaveDayTrendPerDecade === null ? (
                  <p className="mt-2 text-sm text-muted-foreground">Too few complete years for a trend.</p>
                ) : (
                  <>
                    <p className="tabular mt-2 text-2xl font-semibold">{formatSigned(m.heatwaveDayTrendPerDecade, 1)} <span className="text-sm font-normal text-muted-foreground">days/decade</span></p>
                    <p className="mt-1 text-sm text-muted-foreground">{CLASSIFICATION_LABEL[m.heatwaveDayTrendClass ?? 'insufficient_data']}, {m.heatwaveDayTrendYears} complete years</p>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
