import { useMemo } from 'react'
import { HazardChart } from '@/components/HazardChart'
import type { HeatwaveAnalysis } from '@/lib/api/types'
import { CHART_METRICS, buildChartSeries } from '@/lib/chartData'

function LegendSwatch({ kind }: { kind: 'solid' | 'hatched' | 'line' }) {
  if (kind === 'line') {
    return (
      <svg aria-hidden="true" width="22" height="12" viewBox="0 0 22 12">
        <line x1="1" y1="6" x2="21" y2="6" stroke="var(--ink-line)" strokeWidth="2.25" strokeLinecap="round" />
        <circle cx="11" cy="6" r="2.5" fill="var(--ink-line)" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" width="16" height="14" viewBox="0 0 16 14">
      {kind === 'hatched' ? (
        <>
          <defs>
            <pattern id="legend-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--heat)" strokeWidth="2.5" />
            </pattern>
          </defs>
          <rect x="1" y="1" width="14" height="12" rx="2" fill="url(#legend-hatch)" stroke="var(--heat)" strokeDasharray="3 2" />
        </>
      ) : (
        <rect x="1" y="1" width="14" height="12" rx="2" fill="var(--heat)" />
      )}
    </svg>
  )
}

export function ChartsSection({ data }: { data: HeatwaveAnalysis }) {
  const charts = useMemo(
    () => CHART_METRICS.map((metric) => ({ metric, series: buildChartSeries(data, metric) })),
    [data],
  )
  const anyIncomplete = charts.some((c) => c.series.hasIncomplete)
  const rollingWindow = charts.find((c) => c.series.rollingWindow !== null)?.series.rollingWindow ?? null
  const anyRolling = charts.some((c) => c.series.hasRolling)

  return (
    <section id="charts" aria-labelledby="charts-heading" className="scroll-mt-20">
      <h2 id="charts-heading" className="text-xl font-semibold tracking-tight">
        Year by year
      </h2>
      <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
        Each event is counted in the calendar year it starts, even if it runs into the next year.
      </p>

      <ul aria-label="Chart legend" className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <li className="flex items-center gap-2">
          <LegendSwatch kind="solid" /> Complete year
        </li>
        {anyIncomplete ? (
          <li className="flex items-center gap-2">
            <LegendSwatch kind="hatched" /> Incomplete year, shown but not used in trends
          </li>
        ) : null}
        {anyRolling ? (
          <li className="flex items-center gap-2">
            <LegendSwatch kind="line" /> {rollingWindow}-year rolling mean (trailing)
          </li>
        ) : null}
        <li className="text-muted-foreground">No bar: a value of zero, no events (value undefined) or no observations. Hover or focus a year to see which.</li>
      </ul>

      <div className="@container mt-6">
        <div className="grid gap-x-10 gap-y-10 @3xl:grid-cols-2">
          {charts.map(({ metric, series }) => (
            <HazardChart key={metric.key} metric={metric} series={series} />
          ))}
        </div>
      </div>
    </section>
  )
}
