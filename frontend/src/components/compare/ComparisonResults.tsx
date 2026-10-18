import { AlertTriangle, CheckCircle2, LoaderCircle, RotateCw } from 'lucide-react'
import { SeriesSwatch } from '@/components/compare/series'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { describeError, type ApiError } from '@/lib/api/errors'
import {
  CLASSIFICATION_LABEL,
  describeWarning,
  formatCoordinates,
  formatInteger,
  formatNumber,
  formatPercent,
  formatSigned,
} from '@/lib/format'
import { buildCityMetrics, hasError, isLoading, type CityMetrics, type CityResult, type Part } from '@/lib/comparison'

// ------------------------------------------------------------------------------------------ per-city status

function PartStatus({ label, part }: { label: string; part: Part<unknown> }) {
  if (part.status === 'loading' || part.status === 'idle') {
    return (
      <li className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
        {label}: loading…
      </li>
    )
  }
  if (part.status === 'error') {
    return (
      <li className="flex items-start gap-2 text-danger-foreground">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          {label}: failed. {errorSummary(part.error)}
        </span>
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2 text-muted-foreground">
      <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
      {label}: loaded
    </li>
  )
}

function errorSummary(error: ApiError): string {
  const presentation = describeError(error)
  const wait = error.retryAfterSeconds !== null ? ` Try again in about ${error.retryAfterSeconds}s.` : ''
  // The backend message is already user-safe; show it when it adds information beyond the generic title.
  const detail = error.kind === 'validation' && error.message ? ` ${error.message}.` : ''
  return `${presentation.title}.${detail}${wait}`
}

export function CityStatusList({
  cities,
  onRetry,
  onRetryFailed,
}: {
  cities: readonly CityResult[]
  onRetry: (id: string) => void
  onRetryFailed: () => void
}) {
  const failed = cities.filter(hasError)
  return (
    <section aria-labelledby="compare-status-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="compare-status-heading" className="text-xl font-semibold tracking-tight">
          Locations
        </h2>
        {failed.length > 1 ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetryFailed}>
            <RotateCw aria-hidden="true" />
            Retry all failed ({failed.length})
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-3 @2xl:grid-cols-2">
        {cities.map((city) => (
          <li key={city.location.id} className="rounded-lg border bg-surface p-4" data-testid={`city-status-${city.location.id}`}>
            <div className="flex items-center gap-3">
              <SeriesSwatch slot={city.location.slot} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold">{city.location.name}</h3>
                <p className="tabular text-sm text-muted-foreground">{formatCoordinates(city.location.latitude, city.location.longitude)}</p>
              </div>
              {hasError(city) && !isLoading(city) ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onRetry(city.location.id)} aria-label={`Retry ${city.location.name}`}>
                  <RotateCw aria-hidden="true" />
                  Retry
                </Button>
              ) : null}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              <PartStatus label="Heatwave statistics" part={city.heatwave} />
              <PartStatus label="Temperature anomalies" part={city.anomaly} />
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------------------------------ summary cards

function cardValue(metrics: CityMetrics, city: CityResult): { value: string; detail: string } {
  if (!metrics.hasHeatwave) {
    return { value: '—', detail: city.heatwave.status === 'error' ? 'Data unavailable' : 'Loading…' }
  }
  if (metrics.avgAnnualHeatwaveDays === null) return { value: '—', detail: 'No complete year to average over' }
  return {
    value: formatNumber(metrics.avgAnnualHeatwaveDays, 1),
    detail: `heatwave days per complete year (${metrics.completeYears} complete year${metrics.completeYears === 1 ? '' : 's'})`,
  }
}

export function ComparisonCards({ cities }: { cities: readonly CityResult[] }) {
  return (
    <section aria-labelledby="compare-summary-heading" className="@container scroll-mt-20">
      <h2 id="compare-summary-heading" className="text-xl font-semibold tracking-tight">
        Summary
      </h2>
      <ul className="mt-4 grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
        {cities.map((city) => {
          const metrics = buildCityMetrics(city)
          const main = cardValue(metrics, city)
          return (
            <li key={city.location.id} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-surface p-4">
              <div className="flex items-center gap-2">
                <SeriesSwatch slot={city.location.slot} />
                <h3 className="truncate font-semibold">{city.location.name}</h3>
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="tabular font-display text-4xl leading-none font-semibold tracking-tight">{main.value}</span>
              </p>
              <p className="text-sm leading-snug text-muted-foreground">{main.detail}</p>
              <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Events</dt>
                  <dd className="font-semibold">{metrics.hasHeatwave ? formatInteger(metrics.totalEvents) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Mean anomaly</dt>
                  <dd className="font-semibold">
                    {metrics.hasAnomaly ? (metrics.meanAnomalyC === null ? 'n/a' : `${formatSigned(metrics.meanAnomalyC, 2)} °C`) : '—'}
                  </dd>
                </div>
              </dl>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------------------------------ comparison table

interface MetricRow {
  label: string
  note?: string
  render: (m: CityMetrics, city: CityResult) => string
}

/** Why a value is empty: the cell says "not loaded" / "failed" / "no events", never a bare zero. */
function missing(m: CityMetrics, city: CityResult, which: 'heatwave' | 'anomaly'): string | null {
  const has = which === 'heatwave' ? m.hasHeatwave : m.hasAnomaly
  if (has) return null
  const part = which === 'heatwave' ? city.heatwave : city.anomaly
  return part.status === 'error' ? 'Failed to load' : 'Loading…'
}

const METRIC_ROWS: MetricRow[] = [
  {
    label: 'Heatwave events',
    note: 'whole period',
    render: (m, c) => missing(m, c, 'heatwave') ?? formatInteger(m.totalEvents),
  },
  {
    label: 'Heatwave days',
    note: 'whole period',
    render: (m, c) => missing(m, c, 'heatwave') ?? formatInteger(m.totalHeatwaveDays),
  },
  {
    label: 'Mean event duration',
    note: 'days',
    render: (m, c) => missing(m, c, 'heatwave') ?? (m.noEvents ? 'No events' : `${formatNumber(m.meanDurationDays, 1)}`),
  },
  {
    label: 'Longest event',
    note: 'days',
    render: (m, c) => missing(m, c, 'heatwave') ?? (m.noEvents ? 'No events' : formatInteger(m.maxDurationDays)),
  },
  {
    label: 'Heatwave days per year',
    note: 'mean over complete years',
    render: (m, c) =>
      missing(m, c, 'heatwave') ??
      (m.avgAnnualHeatwaveDays === null
        ? 'No complete year'
        : `${formatNumber(m.avgAnnualHeatwaveDays, 1)} (n = ${m.completeYears})`),
  },
  {
    label: 'Heatwave-day trend',
    note: 'days per decade, complete years',
    render: (m, c) => {
      const gap = missing(m, c, 'heatwave')
      if (gap) return gap
      if (m.heatwaveDayTrendPerDecade === null) return 'Not enough data'
      const label = m.heatwaveDayTrendClass ? CLASSIFICATION_LABEL[m.heatwaveDayTrendClass] : ''
      return `${formatSigned(m.heatwaveDayTrendPerDecade, 2)} (${label.toLowerCase()})`
    },
  },
  {
    label: 'Mean daily maximum',
    note: '°C, annual mean over complete years',
    render: (m, c) =>
      missing(m, c, 'anomaly') ??
      (m.avgAnnualMeanDailyMaxC === null ? 'No complete year' : `${formatNumber(m.avgAnnualMeanDailyMaxC, 1)} (n = ${m.anomalyCompleteYears})`),
  },
  {
    label: 'Mean temperature anomaly',
    note: '°C vs 1991–2020 baseline',
    render: (m, c) =>
      missing(m, c, 'anomaly') ?? (m.meanAnomalyC === null ? 'No complete year' : formatSigned(m.meanAnomalyC, 2)),
  },
  {
    label: 'Complete years',
    note: 'of years in the period',
    render: (m, c) => missing(m, c, 'heatwave') ?? `${m.completeYears} of ${m.yearsInWindow}`,
  },
  {
    label: 'Days with valid data',
    note: 'share of the period',
    render: (m, c) => {
      if (m.analysisCoverage === null) return missing(m, c, 'heatwave') ?? '—'
      return `${formatPercent(m.analysisCoverage, 1)}${m.missingDayCount ? ` (${formatInteger(m.missingDayCount)} missing)` : ''}`
    },
  },
]

export function ComparisonTable({ cities }: { cities: readonly CityResult[] }) {
  const metrics = cities.map(buildCityMetrics)
  return (
    <section aria-labelledby="compare-table-heading" className="scroll-mt-20">
      <h2 id="compare-table-heading" className="text-xl font-semibold tracking-tight">
        Side by side
      </h2>
      <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
        “n” is the number of complete years behind an average. “—” or a message means the value is missing or undefined; a
        genuine zero is shown as 0.
      </p>
      <div
        role="region"
        aria-label="Comparison table, scrolls sideways on narrow screens"
        tabIndex={0}
        className="mt-4 max-w-full overflow-x-auto rounded-lg border"
      >
        <table className="tabular w-full min-w-max text-left text-sm">
          <caption className="sr-only">Heatwave and temperature metrics for each selected location</caption>
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Metric</th>
              {cities.map((city) => (
                <th key={city.location.id} scope="col" className="px-4 py-3 font-semibold">
                  <span className="flex items-center gap-2">
                    <SeriesSwatch slot={city.location.slot} />
                    {city.location.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {METRIC_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="px-4 py-2.5 font-medium">
                  {row.label}
                  {row.note ? <span className="block text-xs font-normal text-muted-foreground">{row.note}</span> : null}
                </th>
                {cities.map((city, index) => (
                  <td key={city.location.id} className="px-4 py-2.5">
                    {row.render(metrics[index], city)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------ coverage notes

export function CoverageNotes({ cities }: { cities: readonly CityResult[] }) {
  const loaded = cities.map((city) => ({ city, metrics: buildCityMetrics(city) })).filter(({ metrics }) => metrics.hasHeatwave || metrics.hasAnomaly)
  const incomplete = loaded.filter(({ metrics }) => metrics.completeYears !== null && metrics.yearsInWindow !== null && metrics.completeYears < metrics.yearsInWindow)
  const withWarnings = loaded.filter(({ metrics }) => metrics.warnings.length > 0)

  return (
    <section aria-labelledby="compare-coverage-heading" className="flex flex-col gap-3">
      <h2 id="compare-coverage-heading" className="text-xl font-semibold tracking-tight">
        Data coverage
      </h2>
      <p className="max-w-prose text-[0.9375rem] text-muted-foreground">
        All locations use the same period, the same 1991–2020 baseline years and the same method. Heatwaves and anomalies are
        measured against each location’s own threshold and own baseline, so they show change relative to that place; only the mean
        daily maximum is an absolute temperature. Totals depend on how many days have valid data: a location with missing days can
        show fewer events without being less hot.
      </p>
      {incomplete.length > 0 ? (
        <Alert variant="warning" icon={<AlertTriangle />}>
          <AlertTitle>Not every year is complete</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {incomplete.map(({ city, metrics }) => (
                <li key={city.location.id}>
                  {city.location.name}: {metrics.completeYears} of {metrics.yearsInWindow} years are complete. Per-year averages and
                  trends use only complete years; totals cover the whole period.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {withWarnings.length > 0 ? (
        <details className="text-sm">
          <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md font-medium text-primary underline-offset-4 hover:underline">
            Data-quality notes per location
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {withWarnings.map(({ city, metrics }) => (
              <div key={city.location.id}>
                <p className="font-semibold">{city.location.name}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {metrics.warnings.map((code) => (
                    <li key={code}>{describeWarning(code, undefined, 'anomaly')}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
