import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SeriesSwatch } from '@/components/compare/series'
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { buildCityMetrics, slotKey, type CityResult } from '@/lib/comparison'
import { formatNumber } from '@/lib/format'
import { styleFor } from '@/lib/seriesStyle'

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }

/** Three event statistics that share one unit (days), so one axis is honest. */
const GROUPS = [
  { key: 'avgAnnualHeatwaveDays', label: 'Heatwave days per complete year', digits: 1 },
  { key: 'meanDurationDays', label: 'Average event duration', digits: 1 },
  { key: 'maxDurationDays', label: 'Longest event', digits: 0 },
] as const

type Row = { group: string; digits: number } & Record<string, number | null | string>

export function GroupedBarChart({ cities }: { cities: readonly CityResult[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const reducedMotion = usePrefersReducedMotion()
  const metrics = cities.map((city) => ({ city, m: buildCityMetrics(city) }))
  const rows: Row[] = GROUPS.map((g) => {
    const row: Row = { group: g.label, digits: g.digits }
    for (const { city, m } of metrics) row[slotKey(city.location.slot)] = m.hasHeatwave && !(m.noEvents && g.key !== 'avgAnnualHeatwaveDays') ? m[g.key] : null
    return row
  })
  const any = rows.some((r) => metrics.some(({ city }) => typeof r[slotKey(city.location.slot)] === 'number'))
  const missing = metrics.filter(({ m }) => !m.hasHeatwave).map(({ city }) => city.location.name)
  const noEvents = metrics.filter(({ m }) => m.hasHeatwave && m.noEvents).map(({ city }) => city.location.name)

  return (
    <figure aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-c`} className="flex min-w-0 flex-col gap-3" data-testid="grouped-bar-chart">
      <h3 id={`${uid}-t`} className="text-base font-semibold">
        Heatwave event statistics <span className="text-sm font-normal text-muted-foreground">(days)</span>
      </h3>
      <ul aria-label="Heatwave event statistics legend" className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {cities.map((c) => (
          <li key={c.location.id} className="flex items-center gap-2">
            <SeriesSwatch slot={c.location.slot} />
            {c.location.name}
          </li>
        ))}
      </ul>
      {any ? (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 288 }}>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="group" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} />
              <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined
                  if (!active || !row) return null
                  return (
                    <div className="rounded-md border bg-surface px-3 py-2 text-sm shadow-md">
                      <p className="font-semibold">{row.group}</p>
                      <ul className="mt-1 flex flex-col gap-1">
                        {cities.map((c) => {
                          const v = row[slotKey(c.location.slot)]
                          return (
                            <li key={c.location.id} className="tabular flex items-center gap-2">
                              <SeriesSwatch slot={c.location.slot} />
                              {c.location.name}: {typeof v === 'number' ? `${formatNumber(v, row.digits)} days` : 'no value'}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                }}
              />
              {cities.map((c) => (
                <Bar
                  key={c.location.id}
                  dataKey={slotKey(c.location.slot)}
                  name={c.location.name}
                  fill={styleFor(c.location.slot).color}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                  isAnimationActive={!reducedMotion}
                  animationDuration={400}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No heatwave statistics loaded yet.</p>
      )}
      <figcaption id={`${uid}-c`} className="text-sm text-muted-foreground">
        Each bar is one observation location. Days per year count complete years only.
        {noEvents.length > 0 ? ` No events, so no duration, for: ${noEvents.join(', ')} (left out, not drawn as zero).` : ''}
        {missing.length > 0 ? ` Not loaded: ${missing.join(', ')}.` : ''}
      </figcaption>
      <details className="text-sm">
        <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-primary underline-offset-4 hover:underline">View data as table</summary>
        <table className="tabular mt-2 w-full text-left text-sm">
          <caption className="sr-only">Heatwave event statistics by location</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Statistic</th>
              {cities.map((c) => <th key={c.location.id} scope="col" className="py-1.5 pr-3 text-right font-semibold">{c.location.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.group}>
                <th scope="row" className="py-1.5 pr-3 font-normal">{row.group}</th>
                {cities.map((c) => {
                  const v = row[slotKey(c.location.slot)]
                  return <td key={c.location.id} className="py-1.5 pr-3 text-right">{typeof v === 'number' ? formatNumber(v, row.digits) : '—'}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
