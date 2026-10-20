import { ComparisonChart } from '@/components/compare/ComparisonCharts'
import { COMPARISON_CHARTS, type CityResult, type ComparisonChartKey } from '@/lib/comparison'
import { indicatorById, type IndicatorId } from '@/lib/geo/indicators'

/**
 * Year-by-year lines for up to four analysed locations (the existing comparison chart). The chart that matches the
 * chosen indicator comes first. Slots are assigned by position so every line keeps its own colour, marker and dash.
 */
export function TrendCharts({ cities, indicator, keepSlots = false }: { cities: readonly CityResult[]; indicator: IndicatorId; keepSlots?: boolean }) {
  // Comparison results already carry stable slots; explorer results do not, so they are numbered by position.
  const slotted = keepSlots ? cities.slice(0, 4) : cities.slice(0, 4).map((city, slot) => ({ ...city, location: { ...city.location, slot } }))
  const first: ComparisonChartKey = indicatorById(indicator).source === 'anomaly' ? 'anomaly' : 'heatwave_days'
  const keys: ComparisonChartKey[] = first === 'anomaly' ? ['anomaly', 'heatwave_days'] : ['heatwave_days', 'anomaly']
  return (
    <div className="@container">
      <div className="grid gap-x-10 gap-y-12 @4xl:grid-cols-2">
        {keys.map((key) => (
          <ComparisonChart key={key} config={COMPARISON_CHARTS.find((c) => c.key === key)!} cities={slotted} />
        ))}
      </div>
    </div>
  )
}
