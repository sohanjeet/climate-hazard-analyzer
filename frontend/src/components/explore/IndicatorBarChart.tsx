import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { formatIndicator, type Indicator } from '@/lib/geo/indicators'

export interface BarDatum {
  id: string
  /** e.g. "Rajasthan · Jaipur": the area and the observation location that represents it. */
  label: string
  value: number
}

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 }

/**
 * One indicator across analysed locations, sorted, with direct value labels. Length carries magnitude; colour is
 * only used for polarity on diverging indicators (heat above zero, cool below), matching the map markers.
 */
export function IndicatorBarChart({ indicator, data, title, caption }: { indicator: Indicator; data: readonly BarDatum[]; title: string; caption: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const reducedMotion = usePrefersReducedMotion()
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const diverging = indicator.scale === 'diverging'
  const colour = (v: number) => (!diverging ? 'var(--seq-4)' : v >= 0 ? 'var(--div-heat-2)' : 'var(--div-cool-2)')
  const height = Math.max(120, sorted.length * 34 + 40)

  return (
    <figure aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-caption`} className="flex min-w-0 flex-col gap-3" data-testid="indicator-bar-chart">
      <h3 id={`${uid}-title`} className="text-base font-semibold">
        {title} <span className="text-sm font-normal text-muted-foreground">({indicator.unit})</span>
      </h3>
      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No analysed location has a value for this indicator yet.</p>
      ) : (
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height }}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} domain={diverging ? ['auto', 'auto'] : [0, 'auto']}
                tickFormatter={(v: number) => formatIndicator(indicator, v)} />
              <YAxis type="category" dataKey="label" width={150} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
              {diverging ? <ReferenceLine x={0} stroke="var(--foreground)" strokeWidth={1.5} /> : null}
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  const d = payload?.[0]?.payload as BarDatum | undefined
                  if (!active || !d) return null
                  return (
                    <div className="rounded-md border bg-surface px-3 py-2 text-sm shadow-md">
                      <p className="font-semibold">{d.label}</p>
                      <p className="tabular">{formatIndicator(indicator, d.value)} {indicator.unit}</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="value" radius={4} maxBarSize={18} isAnimationActive={!reducedMotion} animationDuration={400}>
                {sorted.map((d) => <Cell key={d.id} fill={colour(d.value)} />)}
                <LabelList dataKey="value" position="right" formatter={(v: unknown) => formatIndicator(indicator, Number(v))} style={{ fill: 'var(--foreground)', fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <figcaption id={`${uid}-caption`} className="text-sm text-muted-foreground">{caption}</figcaption>
      {sorted.length > 0 ? (
        <details className="text-sm">
          <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-primary underline-offset-4 hover:underline">View data as table</summary>
          <table className="tabular mt-2 w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th scope="col" className="py-1.5 pr-3 font-semibold">Location</th><th scope="col" className="py-1.5 text-right font-semibold">{indicator.label} ({indicator.unit})</th></tr></thead>
            <tbody className="divide-y">
              {sorted.map((d) => (
                <tr key={d.id}><th scope="row" className="py-1.5 pr-3 font-normal">{d.label}</th><td className="py-1.5 text-right">{formatIndicator(indicator, d.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  )
}
