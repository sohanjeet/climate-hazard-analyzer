import type { HeatwaveAnalysis } from '@/lib/api/types'
import { formatCoordinates, formatDateTime, formatPercent } from '@/lib/format'

export function Methodology({ data }: { data: HeatwaveAnalysis }) {
  const { method, baseline, trend } = data
  const items: { term: string; detail: React.ReactNode }[] = [
    {
      term: 'What counts as a heatwave',
      detail: `At least ${method.min_duration_days} consecutive calendar days on which the daily maximum temperature is strictly above one fixed threshold: the ${method.percentile}th percentile of all daily maximum temperatures from ${baseline.start_year} to ${baseline.end_year} (${method.interpolation} interpolation). The same threshold is used for every year, so years can be compared directly.`,
    },
    {
      term: 'Which year an event belongs to',
      detail:
        'The year in which it starts. A heatwave that begins on 28 December and ends on 3 January counts entirely toward the earlier year, and its days are not split.',
    },
    {
      term: 'Missing days',
      detail:
        'Never filled in or estimated. A missing day ends a run of hot days, so affected counts can be too low but not too high. Events next to a missing day are flagged in the data.',
    },
    {
      term: 'Intensity',
      detail:
        'Degrees Celsius above the threshold. Maximum intensity is the largest single-day exceedance; mean intensity weights each day equally. The hottest absolute temperature is reported separately.',
    },
    {
      term: 'Complete and incomplete years',
      detail: `A year is complete when it lies wholly inside the chosen period and at least ${formatPercent(method.year_min_coverage, 0)} of its days have valid data. Only complete years enter trends and rolling averages.`,
    },
    {
      term: 'Trends',
      detail: trend
        ? `Ordinary least squares of each yearly metric on the calendar year, with a two-sided t-test of “slope = 0” at the ${trend.method.significance_level} level. Rolling averages are ${trend.method.rolling_window_years}-year trailing means and are never bridged across gaps. Nothing is extrapolated, so nothing here is a forecast.`
        : 'No trend statistics were returned.',
    },
    {
      term: 'Source and area',
      detail: `Open-Meteo historical archive (${data.source}). Values describe the single reanalysis grid cell nearest to ${formatCoordinates(data.latitude, data.longitude)}, using UTC calendar days. It is not a weather station and not an area average. Computed ${formatDateTime(data.computed_at)}; method ${method.method_version}.`,
    },
  ]

  return (
    <section id="method" aria-labelledby="method-heading" className="scroll-mt-20">
      <h2 id="method-heading" className="text-xl font-semibold tracking-tight">
        Methodology
      </h2>
      <dl className="mt-5 grid gap-x-10 gap-y-5 text-[0.9375rem] md:grid-cols-2">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="font-semibold">{item.term}</dt>
            <dd className="mt-1 text-muted-foreground">{item.detail}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 max-w-prose">
        <h3 className="text-base font-semibold">Limits to keep in mind</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[0.9375rem] text-muted-foreground">
          <li>A statistical trend in one grid cell is an association. It does not show why the change happened.</li>
          <li>Only daily maximum temperature is used. Humidity and night-time heat, which matter for health, are not.</li>
          <li>Grid cells can understate local extremes such as city heat islands or terrain differences.</li>
          <li>Where the period overlaps the baseline, those years are measured against a threshold they helped set.</li>
          <li>In the Southern Hemisphere a summer spans two calendar years, so yearly counts split a season.</li>
        </ul>
      </div>
    </section>
  )
}
