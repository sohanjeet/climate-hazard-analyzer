import { useId } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { InfoTip } from '@/components/InfoTip'
import { Marker, SeriesSwatch } from '@/components/compare/series'
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { formatNumber, formatSigned } from '@/lib/format'
import { styleFor } from '@/lib/seriesStyle'
import {
  COMPARISON_CHARTS,
  POINT_STATE_LABEL,
  buildComparisonChart,
  type CityResult,
  type ComparisonChartConfig,
  type ComparisonChartData,
  type ComparisonRow,
} from '@/lib/comparison'

/** Recharts `dot` renderer for one slot. Points without a value are not drawn. */
function dotFor(slot: number) {
  const style = styleFor(slot)
  return function SeriesDot(props: { cx?: number; cy?: number; value?: unknown; index?: number }): React.ReactElement {
    const { cx, cy, value, index } = props
    if (cx === undefined || cy === undefined || value === null || value === undefined) return <g key={`empty-${index}`} />
    return (
      <g key={`dot-${index}`}>
        <Marker shape={style.shape} cx={cx} cy={cy} r={4} color={style.color} />
      </g>
    )
  }
}

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }

function format(config: ComparisonChartConfig, value: number): string {
  return config.key === 'anomaly' ? formatSigned(value, config.digits) : formatNumber(value, config.digits)
}

function ComparisonTooltip({
  active,
  payload,
  config,
  data,
}: {
  active?: boolean
  payload?: { payload: ComparisonRow }[]
  config: ComparisonChartConfig
  data: ComparisonChartData
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="max-w-72 rounded-md border bg-surface px-3 py-2.5 text-sm shadow-md">
      <p className="font-semibold text-foreground">{row.year}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {data.series.map((series) => {
          const value = row.values[series.dataKey]
          const state = row.states[series.dataKey]
          return (
            <li key={series.dataKey} className="flex items-start gap-2">
              <SeriesSwatch slot={series.location.slot} />
              <span className="tabular min-w-0">
                <span className="text-foreground">{series.location.name}: </span>
                {value === null || value === undefined ? (
                  <span className="text-muted-foreground">{POINT_STATE_LABEL[state ?? 'unavailable']}</span>
                ) : (
                  <span className="font-semibold text-foreground">
                    {format(config, value)} {config.unit}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function captionFor(config: ComparisonChartConfig, data: ComparisonChartData): string {
  const parts = data.series.map((s) => {
    if (!s.available) return `${s.location.name}: data not loaded`
    if (s.omitted === 0) return `${s.location.name}: ${s.plotted} complete years`
    return `${s.location.name}: ${s.plotted} of ${s.plotted + s.omitted} years plotted (${s.omitted} incomplete or without data are left out, not drawn as zero)`
  })
  return `${parts.join('. ')}.${config.key === 'heatwave_days' ? ' A point at 0 means a complete year with no heatwave days; a gap means no comparable data.' : ''}`
}

export function ComparisonChart({ config, cities }: { config: ComparisonChartConfig; cities: readonly CityResult[] }) {
  const reducedMotion = usePrefersReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const data = buildComparisonChart(cities, config.key)
  const anyValue = data.series.some((s) => s.plotted > 0)
  const allZero = data.rows.every((row) => Object.values(row.values).every((v) => v === null || v === 0))

  return (
    <figure aria-labelledby={`title-${uid}`} aria-describedby={`caption-${uid}`} className="flex min-w-0 flex-col gap-3" data-testid={`compare-chart-${config.key}`}>
      <div className="flex items-center gap-1">
        <h3 id={`title-${uid}`} className="text-base font-semibold">
          {config.title}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">({config.unit})</span>
        </h3>
        <InfoTip label={config.title.toLowerCase()}>{config.help}</InfoTip>
      </div>

      <ul aria-label={`${config.title} legend`} className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {data.series.map((s) => (
          <li key={s.dataKey} className="flex items-center gap-2">
            <SeriesSwatch slot={s.location.slot} />
            <span>{s.location.name}</span>
            <span className="sr-only">({styleFor(s.location.slot).shapeName})</span>
          </li>
        ))}
      </ul>

      {anyValue ? (
        <div className="h-64 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 256 }}>
            <LineChart data={data.rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={14} />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                allowDecimals={config.digits > 0}
                domain={config.key === 'heatwave_days' ? [0, allZero ? 1 : 'auto'] : ['auto', 'auto']}
                tickFormatter={(v: number) => (config.key === 'anomaly' ? formatSigned(v, 1) : formatNumber(v, config.digits === 0 ? 0 : 1))}
              />
              <Tooltip cursor={{ stroke: 'var(--border)' }} isAnimationActive={false} content={<ComparisonTooltip config={config} data={data} />} />
              {config.key === 'anomaly' ? <ReferenceLine y={0} stroke="var(--foreground)" strokeWidth={1.5} ifOverflow="extendDomain" /> : null}
              {data.series.map((s) => {
                const style = styleFor(s.location.slot)
                return (
                  <Line
                    key={s.dataKey}
                    dataKey={`values.${s.dataKey}`}
                    name={s.location.name}
                    type="linear"
                    stroke={style.color}
                    strokeWidth={2.25}
                    strokeDasharray={style.dash}
                    connectNulls={false}
                    dot={dotFor(s.location.slot)}
                    activeDot={{ r: 6 }}
                    isAnimationActive={!reducedMotion}
                    animationDuration={450}
                    animationEasing="ease-out"
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No comparable data to chart yet.
        </p>
      )}

      <figcaption id={`caption-${uid}`} className="text-sm leading-snug text-muted-foreground">
        {captionFor(config, data)}
      </figcaption>

      <details className="text-sm">
        <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md font-medium text-primary underline-offset-4 hover:underline">
          View data as table
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border">
          <table className="tabular w-full text-left text-sm">
            <caption className="sr-only">{config.title} by year and location</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Year</th>
                {data.series.map((s) => (
                  <th key={s.dataKey} scope="col" className="px-3 py-2 text-right font-semibold">{s.location.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((row) => (
                <tr key={row.year}>
                  <th scope="row" className="px-3 py-1.5 font-medium">{row.year}</th>
                  {data.series.map((s) => {
                    const value = row.values[s.dataKey]
                    return (
                      <td key={s.dataKey} className="px-3 py-1.5 text-right">
                        {value === null || value === undefined ? (
                          <span className="text-muted-foreground" title={POINT_STATE_LABEL[row.states[s.dataKey] ?? 'unavailable']}>
                            —<span className="sr-only"> {POINT_STATE_LABEL[row.states[s.dataKey] ?? 'unavailable']}</span>
                          </span>
                        ) : (
                          format(config, value)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

export function ComparisonCharts({ cities }: { cities: readonly CityResult[] }) {
  return (
    <section id="compare-charts" aria-labelledby="compare-charts-heading" className="scroll-mt-20">
      <h2 id="compare-charts-heading" className="text-xl font-semibold tracking-tight">
        Year by year
      </h2>
      <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
        Every location uses the same period and the same method. Only complete years are drawn, so lines can be compared year for year.
      </p>
      <div className="@container mt-6">
        <div className="grid gap-x-10 gap-y-12 @4xl:grid-cols-2">
          {COMPARISON_CHARTS.map((config) => (
            <ComparisonChart key={config.key} config={config} cities={cities} />
          ))}
        </div>
      </div>
    </section>
  )
}
