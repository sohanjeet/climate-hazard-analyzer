import { lazy, Suspense, useId, useMemo, useState } from 'react'
import { GitCompareArrows, Loader2, X } from 'lucide-react'
import { LocationPicker } from '@/components/compare/LocationPicker'
import { ComparisonCards, ComparisonTable, CityStatusList, CoverageNotes } from '@/components/compare/ComparisonResults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_FETCHERS, useComparison, type ComparisonFetchers } from '@/hooks/useComparison'
import { MAX_LOCATIONS, MIN_LOCATIONS, PRESET_LOCATIONS, addLocation, hasError, isLoading, type ComparisonLocation } from '@/lib/comparison'
import { LIMITS, defaultFormValues, fullCalendarYears, latestArchiveDate, validateDateRange, type FormErrors } from '@/lib/validation'

// Recharts is the bulk of the bundle and is only needed once there are results.
const ComparisonCharts = lazy(() => import('@/components/compare/ComparisonCharts').then((m) => ({ default: m.ComparisonCharts })))

function defaultLocations(): ComparisonLocation[] {
  let locations: ComparisonLocation[] = []
  for (const preset of PRESET_LOCATIONS.slice(0, 2)) {
    const result = addLocation(locations, preset)
    if (result.ok) locations = result.locations
  }
  return locations
}

export interface ComparisonViewProps {
  fetchers?: ComparisonFetchers
  /** Injected for tests; defaults to the real clock. */
  now?: Date
}

export function ComparisonView({ fetchers = DEFAULT_FETCHERS, now }: ComparisonViewProps) {
  const uid = useId()
  const { state, run, retry, retryFailed, cancel } = useComparison(fetchers)
  const defaults = useMemo(() => defaultFormValues(now), [now])
  const [locations, setLocations] = useState<ComparisonLocation[]>(defaultLocations)
  const [startDate, setStartDate] = useState(defaults.startDate)
  const [endDate, setEndDate] = useState(defaults.endDate)
  const [errors, setErrors] = useState<Pick<FormErrors, 'startDate' | 'endDate'>>({})
  const [selectionError, setSelectionError] = useState<string | null>(null)

  const busy = state.cities.some(isLoading)
  const archiveEnd = latestArchiveDate(now)
  const fullYears = fullCalendarYears(startDate, endDate)
  const failedCount = state.cities.filter(hasError).length
  const finished = state.status === 'running' && !busy

  function setRange(next: { start?: string; end?: string }) {
    if (next.start !== undefined) setStartDate(next.start)
    if (next.end !== undefined) setEndDate(next.end)
    setErrors({})
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const dateErrors = validateDateRange(startDate, endDate, now)
    setErrors(dateErrors)
    if (locations.length < MIN_LOCATIONS) {
      setSelectionError(`Select at least ${MIN_LOCATIONS} locations to compare.`)
      return
    }
    setSelectionError(null)
    if (Object.keys(dateErrors).length > 0) return
    void run(locations, { startDate, endDate })
  }

  const announcement = busy
    ? `Comparing ${state.cities.length} locations. ${state.cities.filter((c) => !isLoading(c)).length} finished.`
    : finished
      ? failedCount > 0
        ? `Comparison finished. ${failedCount} of ${state.cities.length} locations had errors.`
        : `Comparison complete for ${state.cities.length} locations.`
      : ''

  return (
    <div id="compare-top">
      <div className="max-w-3xl">
        <h1 className="font-display text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
          Compare locations
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Put two to four places side by side: heatwave counts and durations, how heatwave days are trending, and how much hotter the
          average daily high has become than each place’s own 1991–2020 average. Every place uses the same period and method.
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[21.5rem_minmax(0,1fr)] lg:items-start lg:gap-12">
        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <form noValidate onSubmit={handleSubmit} aria-label="Comparison controls" className="@container flex flex-col gap-6 rounded-lg border bg-surface p-5">
            <LocationPicker locations={locations} onChange={(next) => { setLocations(next); setSelectionError(null) }} disabled={busy} />
            {selectionError ? (
              <p role="alert" className="text-sm font-medium text-danger-foreground">
                {selectionError}
              </p>
            ) : null}

            <fieldset className="flex flex-col gap-4" disabled={busy}>
              <legend className="mb-1 text-sm font-semibold text-foreground">Shared analysis period</legend>
              <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${uid}-start`}>Start date</Label>
                  <Input
                    id={`${uid}-start`}
                    type="date"
                    min={LIMITS.archiveStart}
                    max={archiveEnd}
                    value={startDate}
                    aria-invalid={errors.startDate ? true : undefined}
                    aria-describedby={errors.startDate ? `${uid}-start-error` : undefined}
                    onChange={(e) => setRange({ start: e.target.value })}
                  />
                  {errors.startDate ? (
                    <p id={`${uid}-start-error`} role="alert" className="text-sm font-medium text-danger-foreground">
                      {errors.startDate}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${uid}-end`}>End date</Label>
                  <Input
                    id={`${uid}-end`}
                    type="date"
                    min={LIMITS.archiveStart}
                    max={archiveEnd}
                    value={endDate}
                    aria-invalid={errors.endDate ? true : undefined}
                    aria-describedby={errors.endDate ? `${uid}-end-error` : undefined}
                    onChange={(e) => setRange({ end: e.target.value })}
                  />
                  {errors.endDate ? (
                    <p id={`${uid}-end-error`} role="alert" className="text-sm font-medium text-danger-foreground">
                      {errors.endDate}
                    </p>
                  ) : null}
                </div>
              </div>
              {!errors.startDate && !errors.endDate && fullYears < LIMITS.minTrendYears ? (
                <p className="text-sm font-medium text-warning-foreground">
                  {fullYears === 0 ? 'This range contains no full calendar year.' : `This range contains ${fullYears} full calendar year${fullYears === 1 ? '' : 's'}.`}{' '}
                  Trends need at least {LIMITS.minTrendYears}.
                </p>
              ) : null}
            </fieldset>

            <div className="flex flex-col gap-3">
              <Button type="submit" disabled={busy} aria-disabled={busy}>
                {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <GitCompareArrows aria-hidden="true" />}
                {busy ? 'Comparing…' : 'Compare locations'}
              </Button>
              {busy ? (
                <Button type="button" variant="outline" onClick={cancel}>
                  <X aria-hidden="true" />
                  Cancel
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Up to {MAX_LOCATIONS} locations. A new location downloads about 30 years of baseline data and can take 5 to 15 seconds (up to
                  45 seconds against a remote database). Locations are analysed two at a time.
                </p>
              )}
            </div>
          </form>
        </aside>

        <div id="compare-results" tabIndex={-1} className="flex min-w-0 scroll-mt-20 flex-col gap-14 outline-none">
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>

          {state.status === 'idle' ? (
            <section aria-labelledby={`${uid}-empty`} className="rounded-lg border border-dashed px-6 py-12 sm:px-10">
              <GitCompareArrows aria-hidden="true" className="size-8 text-heat" />
              <h2 id={`${uid}-empty`} className="mt-4 text-xl font-semibold tracking-tight">
                Choose two to four locations to compare
              </h2>
              <p className="mt-2 max-w-prose text-[0.9375rem] text-muted-foreground">
                Pick preset cities or add coordinates, choose one shared period, and run the comparison. Each location loads on its own, so a
                slow or failed location never hides the others.
              </p>
            </section>
          ) : (
            <>
              <CityStatusList cities={state.cities} onRetry={(id) => void retry(id)} onRetryFailed={() => void retryFailed()} />
              <ComparisonCards cities={state.cities} />
              <ComparisonTable cities={state.cities} />
              <Suspense fallback={<Skeleton className="h-72 w-full" />}>
                <ComparisonCharts cities={state.cities} />
              </Suspense>
              <CoverageNotes cities={state.cities} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
