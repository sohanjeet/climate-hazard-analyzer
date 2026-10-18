import { useId } from 'react'
import { AlertTriangle, LoaderCircle, RotateCw } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { InfoTip } from '@/components/InfoTip'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { describeError } from '@/lib/api/errors'
import type { TemperatureAnomalies } from '@/lib/api/types'
import {
  ANOMALY_STATUS_LABEL,
  buildAnomalyChart,
  describeAnomalySign,
  type AnomalyChartData,
  type AnomalyRow,
} from '@/lib/anomalyData'
import { describeWarning, formatInteger, formatNumber, formatPercent, formatSigned } from '@/lib/format'
import type { Part } from '@/lib/comparison'

export type AnomalyPart = Part<TemperatureAnomalies>

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }

function AnomalyTooltip({
  active,
  payload,
  baselineMean,
  baselineLabel,
}: {
  active?: boolean
  payload?: { payload: AnomalyRow }[]
  baselineMean: number
  baselineLabel: string
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="max-w-64 rounded-md border bg-surface px-3 py-2.5 text-sm shadow-md">
      <p className="font-semibold text-foreground">{row.year}</p>
      {row.anomaly === null ? (
        <p className="mt-1 text-muted-foreground">{ANOMALY_STATUS_LABEL[row.status]}</p>
      ) : (
        <p className="tabular mt-1 text-foreground">
          <span className="font-semibold">{formatSigned(row.anomaly, 2)} °C</span>{' '}
          <span className="text-muted-foreground">{describeAnomalySign(row.anomaly)}</span>
        </p>
      )}
      <p className="tabular mt-1.5 text-muted-foreground">
        Annual mean daily maximum: {row.reportedMean === null ? 'not available' : `${formatNumber(row.reportedMean, 2)} °C`}
      </p>
      <p className="tabular text-muted-foreground">
        {baselineLabel} baseline mean: {formatNumber(baselineMean, 2)} °C
      </p>
      <p className="tabular mt-1.5 text-muted-foreground">
        {row.observed} of {row.expected} days observed ({formatPercent(row.coverage, 0)})
      </p>
    </div>
  )
}

function Stat({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <p className="flex items-baseline gap-1.5">
          <span className="tabular font-display text-3xl leading-none font-semibold tracking-tight">{value}</span>
          {unit ? <span className="text-sm font-medium text-muted-foreground">{unit}</span> : null}
        </p>
        <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{detail}</p>
      </dd>
    </div>
  )
}

function ChartFrame({
  title,
  unit,
  help,
  caption,
  testId,
  legend,
  children,
}: {
  title: string
  unit: string
  help: string
  caption: string
  testId: string
  legend?: React.ReactNode
  children: React.ReactNode
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <figure aria-labelledby={`t-${uid}`} aria-describedby={`c-${uid}`} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <h3 id={`t-${uid}`} className="text-base font-semibold">
          {title}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">({unit})</span>
        </h3>
        <InfoTip label={title.toLowerCase()}>{help}</InfoTip>
      </div>
      {legend}
      <div className="h-60 w-full sm:h-64" data-testid={testId}>
        {children}
      </div>
      <figcaption id={`c-${uid}`} className="text-sm leading-snug text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}

function AnomalyBarChart({ chart }: { chart: AnomalyChartData }) {
  const reducedMotion = usePrefersReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const hatch = `anomaly-hatch-${uid}`
  const animation = { isAnimationActive: !reducedMotion, animationDuration: 450, animationEasing: 'ease-out' as const }
  return (
    <ChartFrame
      title="Annual temperature anomaly"
      unit="°C vs baseline"
      testId="chart-anomaly-bars"
      legend={
        <ul aria-label="Anomaly bar chart legend" className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <svg aria-hidden="true" width="16" height="14" viewBox="0 0 16 14">
              <rect x="1" y="1" width="14" height="12" rx="2" fill="var(--heat)" />
            </svg>
            Warmer than baseline (above zero)
          </li>
          <li className="flex items-center gap-2">
            <svg aria-hidden="true" width="16" height="14" viewBox="0 0 16 14">
              <defs>
                <pattern id="anomaly-legend-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--surface)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--cool)" strokeWidth="2.5" />
                </pattern>
              </defs>
              <rect x="1" y="1" width="14" height="12" rx="2" fill="url(#anomaly-legend-hatch)" stroke="var(--cool)" strokeDasharray="3 2" />
            </svg>
            Cooler than baseline (below zero)
          </li>
        </ul>
      }
      help="How much warmer (+) or cooler (−) each complete year’s mean daily maximum temperature was than the baseline mean. It describes the past; nothing is projected."
      caption={`Solid bars above zero: warmer than the ${chart.baselineLabel} baseline. Hatched bars below zero: cooler. A year without a bar has no anomaly (incomplete or no data); that is not a zero.`}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 256 }}>
        <ComposedChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
          <defs>
            <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--cool)" strokeWidth="2.5" />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={14} />
          <YAxis width={40} tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => formatSigned(v, 1)} domain={['auto', 'auto']} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            isAnimationActive={false}
            content={<AnomalyTooltip baselineMean={chart.baselineMean} baselineLabel={chart.baselineLabel} />}
          />
          <ReferenceLine y={0} stroke="var(--foreground)" strokeWidth={1.5} ifOverflow="extendDomain" />
          <Bar dataKey="positive" name="Warmer than baseline" stackId="a" fill="var(--heat)" radius={[2, 2, 0, 0]} {...animation} />
          <Bar
            dataKey="negative"
            name="Cooler than baseline"
            stackId="a"
            fill={`url(#${hatch})`}
            stroke="var(--cool)"
            strokeWidth={1}
            strokeDasharray="3 2"
            radius={[0, 0, 2, 2]}
            {...animation}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function MeanLineChart({ chart }: { chart: AnomalyChartData }) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <ChartFrame
      title="Annual mean daily maximum temperature"
      unit="°C"
      testId="chart-anomaly-mean"
      legend={
        <ul aria-label="Annual mean chart legend" className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <svg aria-hidden="true" width="30" height="12" viewBox="0 0 30 12">
              <line x1="1" y1="6" x2="29" y2="6" stroke="var(--ink-line)" strokeWidth="2.25" strokeLinecap="round" />
              <circle cx="15" cy="6" r="3" fill="var(--ink-line)" />
            </svg>
            Annual mean daily maximum
          </li>
          <li className="flex items-center gap-2">
            <svg aria-hidden="true" width="30" height="12" viewBox="0 0 30 12">
              <line x1="1" y1="6" x2="29" y2="6" stroke="var(--muted-foreground)" strokeWidth="1.75" strokeDasharray="6 4" />
            </svg>
            {chart.baselineLabel} baseline mean ({formatNumber(chart.baselineMean, 1)} °C)
          </li>
        </ul>
      }
      help="The average of the daily maximum temperatures in each complete year. This is not the hottest day of the year and not the mean air temperature."
      caption={`The dashed line is the ${chart.baselineLabel} baseline mean daily maximum, ${formatNumber(chart.baselineMean, 1)} °C. Years above it have a positive anomaly. Incomplete years are left out of the line.`}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 256 }}>
        <ComposedChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={14} />
          <YAxis width={40} tickLine={false} axisLine={false} tick={AXIS_TICK} domain={['auto', 'auto']} tickFormatter={(v: number) => formatNumber(v, 1)} />
          <Tooltip
            cursor={{ stroke: 'var(--border)' }}
            isAnimationActive={false}
            content={<AnomalyTooltip baselineMean={chart.baselineMean} baselineLabel={chart.baselineLabel} />}
          />
          <ReferenceLine
            y={chart.baselineMean}
            stroke="var(--muted-foreground)"
            strokeDasharray="6 4"
            strokeWidth={1.75}
            ifOverflow="extendDomain"
          />
          <Line
            dataKey="meanDailyMax"
            name="Annual mean daily maximum"
            type="linear"
            stroke="var(--ink-line)"
            strokeWidth={2.25}
            connectNulls={false}
            dot={{ r: 3, fill: 'var(--ink-line)', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={!reducedMotion}
            animationDuration={450}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function YearTable({ chart }: { chart: AnomalyChartData }) {
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md font-medium text-primary underline-offset-4 hover:underline">
        View anomalies as table
      </summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-md border">
        <table className="tabular w-full text-left text-sm">
          <caption className="sr-only">Annual mean daily maximum temperature and anomaly by year</caption>
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Year</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Mean daily max (°C)</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Anomaly (°C)</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Days observed</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {chart.rows.map((row) => (
              <tr key={row.year}>
                <th scope="row" className="px-3 py-1.5 font-medium">{row.year}</th>
                <td className="px-3 py-1.5 text-right">{formatNumber(row.reportedMean, 2)}</td>
                <td className="px-3 py-1.5 text-right">{formatSigned(row.anomaly, 2)}</td>
                <td className="px-3 py-1.5">{ANOMALY_STATUS_LABEL[row.status]}</td>
                <td className="px-3 py-1.5 text-right">{row.observed}/{row.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function AnomalyContent({ data }: { data: TemperatureAnomalies }) {
  const chart = buildAnomalyChart(data)
  const { summary, baseline, method, data_quality } = data
  const baselineLabel = chart.baselineLabel
  const warnings = data_quality.warnings
  const noComplete = summary.complete_years === 0

  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 border-y py-6 @2xl:grid-cols-4">
        <Stat
          label={`${baselineLabel} baseline`}
          value={formatNumber(baseline.mean_daily_max_c, 1)}
          unit="°C"
          detail={`mean daily maximum, ${formatInteger(baseline.observation_count)} of ${formatInteger(baseline.expected_count)} days valid`}
        />
        <Stat
          label="Mean anomaly"
          value={formatSigned(summary.mean_anomaly_c, 2)}
          unit={summary.mean_anomaly_c === null ? undefined : '°C'}
          detail={noComplete ? 'No complete year in this period' : `average over ${summary.complete_years} complete year${summary.complete_years === 1 ? '' : 's'}`}
        />
        <Stat
          label="Warmest year"
          value={summary.max_anomaly_year === null ? '—' : String(summary.max_anomaly_year)}
          detail={summary.max_anomaly_c === null ? 'No complete year' : `${formatSigned(summary.max_anomaly_c, 2)} °C vs baseline`}
        />
        <Stat
          label="Coolest year"
          value={summary.min_anomaly_year === null ? '—' : String(summary.min_anomaly_year)}
          detail={summary.min_anomaly_c === null ? 'No complete year' : `${formatSigned(summary.min_anomaly_c, 2)} °C vs baseline`}
        />
      </dl>
      <p className="mt-3 text-sm text-muted-foreground">
        {noComplete
          ? 'No year in this period is complete, so no anomaly can be shown. The annual means below are still reported.'
          : `${summary.positive_years} warmer, ${summary.negative_years} cooler and ${summary.zero_years} equal to baseline, out of ${summary.complete_years} complete year${summary.complete_years === 1 ? '' : 's'}.`}
      </p>

      <div className="@container mt-6">
        <div className="grid gap-x-10 gap-y-10 @3xl:grid-cols-2">
          <AnomalyBarChart chart={chart} />
          <MeanLineChart chart={chart} />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <YearTable chart={chart} />
        {warnings.length > 0 ? (
          <Alert variant="warning" icon={<AlertTriangle />}>
            <AlertTitle>Data-quality notes</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {warnings.map((code) => (
                  <li key={code}>{describeWarning(code, baseline, 'anomaly')}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <details className="text-sm">
          <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md font-medium text-primary underline-offset-4 hover:underline">
            How anomalies are calculated
          </summary>
          <div className="mt-2 max-w-prose space-y-2 text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Anomaly = annual mean daily maximum − baseline mean daily maximum.</span>{' '}
              For example, a year averaging 32.4 °C against a baseline of 30.8 °C has an anomaly of +1.6 °C.
            </p>
            <p>
              The baseline is the mean of every valid daily maximum from {baseline.start_year} to {baseline.end_year} (fixed, the same
              period used for the heatwave threshold). This is a different quantity from the heatwave threshold, which is the 95th
              percentile. It is also not the absolute hottest day of a year, and not the mean air temperature.
            </p>
            <p>
              Missing days are left out, never filled in or counted as zero. A year gets an anomaly only if it lies wholly inside the
              chosen period and at least {formatPercent(method.year_min_coverage, 0)} of its days are valid; other years show
              their mean but no anomaly. The baseline needs at least {formatPercent(method.baseline_min_coverage, 0)} valid days.
              Values are rounded to {method.temperature_decimals} decimals. Method {method.method_version}. Anomalies describe the
              past and are not forecasts.
            </p>
          </div>
        </details>
      </div>
    </>
  )
}

/** The "Temperature anomalies" section of the single-location results, with its own loading / error / retry. */
export function AnomalySection({ part, onRetry }: { part: AnomalyPart; onRetry: () => void }) {
  return (
    <section id="anomalies" aria-labelledby="anomalies-heading" className="@container scroll-mt-20">
      <h2 id="anomalies-heading" className="text-xl font-semibold tracking-tight">
        Temperature anomalies
      </h2>
      <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
        How each year’s average daily high compares with the 1991–2020 average daily high at this location. A record of the past, not a forecast.
      </p>

      {part.status === 'success' ? <AnomalyContent data={part.data} /> : null}

      {part.status === 'idle' || part.status === 'loading' ? (
        <div role="status" aria-busy="true" className="mt-4 flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            Calculating temperature anomalies…
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : null}

      {part.status === 'error' ? (
        <Alert variant="danger" icon={<AlertTriangle />} className="mt-4">
          <AlertTitle>Temperature anomalies could not be loaded</AlertTitle>
          <AlertDescription>
            {describeError(part.error).description} {part.error.message}
          </AlertDescription>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RotateCw aria-hidden="true" />
            Retry anomalies
          </Button>
        </Alert>
      ) : null}
    </section>
  )
}
