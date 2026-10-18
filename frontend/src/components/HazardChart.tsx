import { useId } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { InfoTip } from '@/components/InfoTip'
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import {
  STATUS_LABEL,
  describeRollingStatus,
  type ChartMetricConfig,
  type ChartRow,
  type ChartSeries,
} from '@/lib/chartData'
import { formatNumber, formatPercent } from '@/lib/format'

function ChartTooltip({
  active,
  payload,
  metric,
  rollingWindow,
}: {
  active?: boolean
  payload?: { payload: ChartRow }[]
  metric: ChartMetricConfig
  rollingWindow: number | null
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="max-w-64 rounded-md border bg-surface px-3 py-2.5 text-sm shadow-md">
      <p className="font-semibold text-foreground">{row.year}</p>
      <p className="tabular mt-1 text-foreground">
        {row.value === null ? (
          <span className="text-muted-foreground">{STATUS_LABEL[row.status]}</span>
        ) : (
          <>
            <span className="font-semibold">{formatNumber(row.value, metric.digits)}</span> {metric.unit}
          </>
        )}
      </p>
      {row.value !== null ? <p className="mt-0.5 text-muted-foreground">{STATUS_LABEL[row.status]}</p> : null}
      <p className="tabular mt-1.5 text-muted-foreground">
        {row.daysObserved} of {row.daysExpected} days observed ({formatPercent(row.coverage, 0)})
      </p>
      <p className="tabular mt-1.5 text-muted-foreground">
        {row.rolling !== null
          ? `${rollingWindow}-year mean: ${formatNumber(row.rolling, metric.digits === 0 ? 1 : metric.digits)}`
          : describeRollingStatus(row.rollingStatus, row.gapYears, rollingWindow)}
      </p>
    </div>
  )
}

function captionFor(metric: ChartMetricConfig, series: ChartSeries): string {
  const rows = series.rows
  const count = (status: ChartRow['status']) => rows.filter((r) => r.status === status).length
  const parts: string[] = [`${rows.length} year${rows.length === 1 ? '' : 's'} shown`]
  const incomplete = count('incomplete')
  if (incomplete) parts.push(`${incomplete} incomplete (hatched, not used in trends)`)
  const noEvents = count('no_events')
  if (noEvents) parts.push(`${noEvents} without events (no bar: ${metric.title.toLowerCase()} is undefined, not zero)`)
  const noData = count('no_data')
  if (noData) parts.push(`${noData} without any observations (no bar)`)
  return `${parts.join('; ')}.`
}

/** Annual bars (solid = complete year, hatched = incomplete year) with an optional trailing rolling-mean line. */
export function HazardChart({
  metric,
  series,
  headingLevel = 3,
}: {
  metric: ChartMetricConfig
  series: ChartSeries
  headingLevel?: 3 | 4
}) {
  const reducedMotion = usePrefersReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const patternId = `hatch-${uid}`
  const titleId = `chart-title-${uid}`
  const captionId = `chart-caption-${uid}`
  const Heading = `h${headingLevel}` as 'h3' | 'h4'
  const allZero = series.rows.every((r) => r.value === null || r.value === 0)

  return (
    <figure aria-labelledby={titleId} aria-describedby={captionId} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <Heading id={titleId} className="text-base font-semibold">
          {metric.title}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">({metric.unit})</span>
        </Heading>
        <InfoTip label={metric.title.toLowerCase()}>{metric.help}</InfoTip>
      </div>

      <div className="h-60 w-full sm:h-64" data-testid={`chart-${metric.key}`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 256 }}>
          <ComposedChart data={series.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            <defs>
              <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--surface)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--heat)" strokeWidth="2.5" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={14}
            />
            <YAxis
              width={36}
              tickLine={false}
              axisLine={false}
              allowDecimals={metric.digits > 0}
              domain={[0, allZero ? 1 : 'auto']}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
              isAnimationActive={false}
              content={<ChartTooltip metric={metric} rollingWindow={series.rollingWindow} />}
            />
            <Bar
              dataKey="completeValue"
              name="Complete year"
              stackId="annual"
              fill="var(--heat)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={!reducedMotion}
              animationDuration={450}
              animationEasing="ease-out"
            />
            <Bar
              dataKey="incompleteValue"
              name="Incomplete year"
              stackId="annual"
              fill={`url(#${patternId})`}
              stroke="var(--heat)"
              strokeWidth={1}
              strokeDasharray="3 2"
              radius={[2, 2, 0, 0]}
              isAnimationActive={!reducedMotion}
              animationDuration={450}
              animationEasing="ease-out"
            />
            {series.hasRolling ? (
              <Line
                dataKey="rolling"
                name="Rolling mean"
                type="monotone"
                stroke="var(--ink-line)"
                strokeWidth={2.25}
                connectNulls={false}
                dot={{ r: 2.5, fill: 'var(--ink-line)', strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={!reducedMotion}
                animationDuration={450}
                animationEasing="ease-out"
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <figcaption id={captionId} className="text-sm leading-snug text-muted-foreground">
        {captionFor(metric, series)}
        {!series.hasRolling ? ' The rolling average is unavailable: it needs a full window of complete years that each have a value.' : ''}
      </figcaption>

      <details className="group text-sm">
        <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md font-medium text-primary underline-offset-4 hover:underline">
          View data as table
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border">
          <table className="tabular w-full text-left text-sm">
            <caption className="sr-only">{metric.title} by year</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Year</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{metric.unit}</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Days observed</th>
                {series.hasRolling ? (
                  <th scope="col" className="px-3 py-2 text-right font-semibold">{series.rollingWindow}-yr mean</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {series.rows.map((row) => (
                <tr key={row.year}>
                  <th scope="row" className="px-3 py-1.5 font-medium">{row.year}</th>
                  <td className="px-3 py-1.5 text-right">{row.value === null ? '—' : formatNumber(row.value, metric.digits)}</td>
                  <td className="px-3 py-1.5">{STATUS_LABEL[row.status]}</td>
                  <td className="px-3 py-1.5 text-right">{row.daysObserved}/{row.daysExpected}</td>
                  {series.hasRolling ? (
                    <td className="px-3 py-1.5 text-right">{row.rolling === null ? '—' : formatNumber(row.rolling, 2)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
