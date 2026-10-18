import { InfoTip } from '@/components/InfoTip'
import type { HeatwaveAnalysis } from '@/lib/api/types'
import { formatInteger, formatNumber } from '@/lib/format'

interface StatProps {
  label: string
  tip: React.ReactNode
  value: string
  unit?: string
  detail: React.ReactNode
  featured?: boolean
}

function Stat({ label, tip, value, unit, detail, featured }: StatProps) {
  return (
    <div className={featured ? 'col-span-2 @2xl:col-span-1' : undefined}>
      <dt className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
        {label}
        <InfoTip label={label.toLowerCase()}>{tip}</InfoTip>
      </dt>
      <dd className="mt-1">
        <p className="flex items-baseline gap-1.5">
          <span className="tabular font-display text-4xl leading-none font-semibold tracking-tight text-foreground sm:text-[2.5rem]">
            {value}
          </span>
          {unit ? <span className="text-sm font-medium text-muted-foreground">{unit}</span> : null}
        </p>
        <p className="mt-2 text-sm leading-snug text-muted-foreground">{detail}</p>
      </dd>
    </div>
  )
}

export function SummaryMetrics({ data }: { data: HeatwaveAnalysis }) {
  const { summary, baseline, method } = data
  const noEvents = summary.total_events === 0
  const perYear = (value: number | null) => (value === null ? null : formatNumber(value, 1))

  return (
    <section id="summary" aria-labelledby="summary-heading" className="@container scroll-mt-20">
      <h2 id="summary-heading" className="text-xl font-semibold tracking-tight">
        Summary
      </h2>
      {/* Columns follow the width of the results area, not the window: it shares the row with the form. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 border-y py-7 @2xl:grid-cols-3 @4xl:grid-cols-5">
        <Stat
          featured
          label="Heatwave events"
          tip="Separate runs of at least 3 consecutive days above the baseline threshold, counted over the whole period."
          value={formatInteger(summary.total_events)}
          detail={
            perYear(summary.events_per_complete_year)
              ? `${perYear(summary.events_per_complete_year)} per complete year`
              : 'No complete year to average over'
          }
        />
        <Stat
          label="Heatwave days"
          tip="Total days that fall inside heatwave events. Each event is counted in full, even if it crosses a year boundary."
          value={formatInteger(summary.total_heatwave_days)}
          unit="days"
          detail={
            perYear(summary.heatwave_days_per_complete_year)
              ? `${perYear(summary.heatwave_days_per_complete_year)} per complete year`
              : 'No complete year to average over'
          }
        />
        <Stat
          label="Mean event duration"
          tip="Average length of a heatwave event. Not defined when there are no events."
          value={formatNumber(summary.mean_duration_days, 1)}
          unit={summary.mean_duration_days === null ? undefined : 'days'}
          detail={noEvents ? 'No events in this period' : `Longest event: ${summary.max_duration_days} days`}
        />
        <Stat
          label="Maximum intensity"
          tip="The hottest single day of any event, measured as degrees Celsius above the baseline threshold. Peak temperature is shown for context."
          value={summary.max_intensity_c === null ? '—' : `+${formatNumber(summary.max_intensity_c, 1)}`}
          unit={summary.max_intensity_c === null ? undefined : '°C'}
          detail={
            noEvents
              ? 'No events in this period'
              : `above threshold; hottest day ${formatNumber(summary.peak_temperature_c, 1)} °C`
          }
        />
        <Stat
          label="Baseline threshold"
          tip={`The ${method.percentile}th percentile of daily maximum temperature over ${baseline.start_year} to ${baseline.end_year}. A day counts as hot only if it is strictly above this value. The same threshold is used for every year.`}
          value={formatNumber(baseline.threshold_c, 1)}
          unit="°C"
          detail={`${method.percentile}th percentile of daily highs, ${baseline.start_year}–${baseline.end_year}`}
        />
      </dl>
    </section>
  )
}
