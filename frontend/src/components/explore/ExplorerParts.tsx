import { useId } from 'react'
import { AlertTriangle, Database, DownloadCloud, Info, Loader2, MapPin, Play, RotateCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { LocationCoverage, ObservationLocation } from '@/lib/api/types'
import { describeError } from '@/lib/api/errors'
import type { CityResult } from '@/lib/comparison'
import { formatCoordinates } from '@/lib/format'
import { COVERAGE_TEXT } from '@/lib/geo/coverage'
import {
  INDICATORS,
  formatIndicator,
  indicatorById,
  indicatorValue,
  type ColorScale,
  type IndicatorId,
} from '@/lib/geo/indicators'
import { FIRST_ARCHIVE_YEAR, lastCompleteYear, type YearRange } from '@/lib/geo/period'

const SELECT =
  'h-11 w-full rounded-md border border-input bg-surface px-3 text-base text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:text-sm'

/** The rule every map page states up front. */
export function ScopeNotice({ area }: { area: 'country' | 'state' }) {
  return (
    <div className="flex gap-3 rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong className="font-semibold">Location-level observations.</strong> Every value describes one observation location (the reanalysis
        grid cell nearest its coordinates), not the whole {area}. {area === 'state' ? 'Most states are represented by their capital.' : ''} Area
        colours show only whether data is available, never a climate value.
      </p>
    </div>
  )
}

export function CoverageChip({ coverage }: { coverage: LocationCoverage | undefined }) {
  if (!coverage) return null
  const text = COVERAGE_TEXT[coverage.status]
  const Icon = coverage.status === 'stored' ? Database : DownloadCloud
  return (
    <Badge variant={coverage.status === 'stored' ? 'info' : 'neutral'} title={text.detail}>
      <Icon aria-hidden="true" />
      {text.label}
    </Badge>
  )
}

export function ExplorerControls({
  years,
  onYearsChange,
  indicator,
  onIndicatorChange,
  problem,
  now,
  children,
}: {
  years: YearRange
  onYearsChange: (next: YearRange) => void
  indicator: IndicatorId
  onIndicatorChange: (next: IndicatorId) => void
  problem: string | null
  now?: Date
  children?: React.ReactNode
}) {
  const uid = useId()
  const last = lastCompleteYear(now)
  const options = Array.from({ length: last - FIRST_ARCHIVE_YEAR + 1 }, (_, i) => last - i)
  const full = years.endYear - years.startYear + 1
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-4 rounded-lg border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.8fr)]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-from`}>From year</Label>
          <select id={`${uid}-from`} className={SELECT} value={years.startYear} aria-invalid={problem ? true : undefined}
            onChange={(e) => onYearsChange({ ...years, startYear: Number(e.target.value) })}>
            {options.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-to`}>To year</Label>
          <select id={`${uid}-to`} className={SELECT} value={years.endYear} aria-invalid={problem ? true : undefined}
            onChange={(e) => onYearsChange({ ...years, endYear: Number(e.target.value) })}>
            {options.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-indicator`}>Climate indicator</Label>
          <select id={`${uid}-indicator`} className={SELECT} value={indicator} onChange={(e) => onIndicatorChange(e.target.value as IndicatorId)}>
            {INDICATORS.map((i) => (
              <option key={i.id} value={i.id} disabled={!i.available}>
                {i.label} ({i.unit}){i.available ? '' : ' — not available'}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-1">{children}</div>
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-foreground">{problem}</p>
      ) : full < 3 ? (
        <p className="text-sm font-medium text-warning-foreground">This period has {full} full year{full === 1 ? '' : 's'}; trends need at least 3.</p>
      ) : null}
    </div>
  )
}

export interface LegendCoverageItem {
  label: string
  color: string
}

export function MapLegend({
  coverage,
  indicator,
  scale,
  analysedCount,
}: {
  coverage: readonly LegendCoverageItem[]
  indicator: IndicatorId
  scale: ColorScale | null
  analysedCount: number
}) {
  const def = indicatorById(indicator)
  return (
    <div className="grid gap-5 text-sm sm:grid-cols-2">
      <section aria-label="Area colours">
        <h3 className="font-semibold">Areas: data availability</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {coverage.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-4 shrink-0 rounded-sm border" style={{ background: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Marker colours">
        <h3 className="font-semibold">
          Markers: {def.label} <span className="font-normal text-muted-foreground">({def.unit})</span>
        </h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {scale
            ? scale.classes.map((c) => (
                <li key={c.label} className="tabular flex items-center gap-2">
                  <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full border border-foreground" style={{ background: c.color }} />
                  {c.label}
                </li>
              ))
            : null}
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full border-[1.75px] border-foreground bg-surface" />
            Not analysed yet, or no value
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          {scale
            ? `Classes span the ${analysedCount} location${analysedCount === 1 ? '' : 's'} analysed in this session; they change as you analyse more.`
            : 'Analyse a location to colour its marker.'}
        </p>
      </section>
    </div>
  )
}

const METRIC_ROWS: IndicatorId[] = ['heatwave_days', 'events', 'mean_duration', 'max_duration', 'anomaly', 'heatwave_trend']

const ROLE_LABEL = { capital: 'Capital', major_city: 'Major city' } as const

export function LocationCard({
  location,
  result,
  coverage,
  indicator,
  onAnalyze,
  busy,
  disabledReason,
  scopeLabel,
}: {
  location: ObservationLocation
  result: CityResult | undefined
  coverage: LocationCoverage | undefined
  indicator: IndicatorId
  onAnalyze: () => void
  busy: boolean
  disabledReason: string | null
  /** For example "Capital-city observation point, not a state-wide average". */
  scopeLabel: string
}) {
  const uid = useId()
  const loading = result && (result.heatwave.status === 'loading' || result.anomaly.status === 'loading')
  const failed = result && (result.heatwave.status === 'error' || result.anomaly.status === 'error')
  const done = result && !loading && !failed && result.heatwave.status === 'success' && result.anomaly.status === 'success'
  const firstError = result?.heatwave.status === 'error' ? result.heatwave.error : result?.anomaly.status === 'error' ? result.anomaly.error : null

  return (
    <article aria-labelledby={`${uid}-name`} className="rounded-lg border bg-surface p-4" data-testid="location-card">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 id={`${uid}-name`} className="flex items-center gap-1.5 font-semibold break-words">
            <MapPin aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {location.name}
          </h3>
          <p className="tabular mt-0.5 text-sm text-muted-foreground">
            {ROLE_LABEL[location.role]} · {formatCoordinates(location.latitude, location.longitude)}
          </p>
        </div>
        <CoverageChip coverage={coverage} />
      </div>
      <p className="mt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{scopeLabel}</p>
      {location.role_note ? <p className="mt-1 text-sm text-muted-foreground">{location.role_note}</p> : null}

      {done ? (
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
          {METRIC_ROWS.map((id) => {
            const def = indicatorById(id)
            const v = indicatorValue(id, result)
            return (
              <div key={id} className={`contents ${id === indicator ? 'font-semibold' : ''}`}>
                <dt className={id === indicator ? 'text-foreground' : 'text-muted-foreground'}>{def.label}</dt>
                <dd className="tabular text-right">
                  {v.kind === 'value' ? (
                    <>
                      {formatIndicator(def, v.value)} <span className="text-muted-foreground">{def.unit}</span>
                    </>
                  ) : v.kind === 'empty' ? (
                    <span className="text-muted-foreground" title={v.reason}>
                      —<span className="sr-only"> {v.reason}</span>
                    </span>
                  ) : null}
                </dd>
              </div>
            )
          })}
          <div className="contents">
            <dt className="text-muted-foreground">Temperature trend</dt>
            <dd className="text-right text-muted-foreground">Not available</dd>
          </div>
        </dl>
      ) : null}

      {failed && firstError ? (
        <p role="alert" className="mt-3 flex gap-2 text-sm text-danger-foreground">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {describeError(firstError).title}. {describeError(firstError).description}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {done ? null : (
          <Button type="button" size="sm" variant={failed ? 'outline' : 'default'} onClick={onAnalyze} disabled={Boolean(loading) || busy || Boolean(disabledReason)}>
            {loading ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : failed ? <RotateCw aria-hidden="true" /> : <Play aria-hidden="true" />}
            {loading ? 'Analysing…' : failed ? `Retry ${location.name}` : `Analyse ${location.name}`}
          </Button>
        )}
        {disabledReason && !done ? <span className="text-sm text-muted-foreground">{disabledReason}</span> : null}
        {!done && !loading && !failed && !disabledReason ? (
          <span className="text-sm text-muted-foreground">{coverage?.status === 'stored' ? 'About a second.' : 'Can take 5 to 45 seconds the first time.'}</span>
        ) : null}
      </div>
    </article>
  )
}
