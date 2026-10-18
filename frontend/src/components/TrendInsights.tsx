import { CircleHelp, Minus, Scale, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { InfoTip } from '@/components/InfoTip'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import type { HeatwaveAnalysis, TrendClassification, TrendMetric } from '@/lib/api/types'
import {
  CLASSIFICATION_LABEL,
  describeNote,
  describeWarning,
  formatNumber,
  formatPValue,
  formatSigned,
} from '@/lib/format'

const CLASSIFICATION_ICON: Record<TrendClassification, React.ReactNode> = {
  increasing: <TrendingUp aria-hidden="true" />,
  decreasing: <TrendingDown aria-hidden="true" />,
  no_significant_trend: <Minus aria-hidden="true" />,
  insufficient_data: <CircleHelp aria-hidden="true" />,
}

function significanceText(metric: TrendMetric, alpha: number): string {
  const level = `${Math.round(alpha * 100)}% level`
  if (metric.classification === 'insufficient_data') return 'Not enough complete years to estimate a trend.'
  if (!metric.p_value_supported || metric.p_value === null) return 'No p-value: every year has the same value, or there are too few years.'
  if (metric.classification === 'no_significant_trend') {
    return `Not statistically significant at the ${level} (p ${metric.p_value < 0.001 ? '' : '= '}${formatPValue(metric.p_value)}). This does not show that nothing changed.`
  }
  return `Statistically significant at the ${level} (p ${metric.p_value < 0.001 ? '' : '= '}${formatPValue(metric.p_value)}). This is an association in these data, not proof of a cause.`
}

function MetricRow({ metric, statement, alpha }: { metric: TrendMetric; statement: string | undefined; alpha: number }) {
  const hasSlope = metric.slope_per_decade !== null && metric.classification !== 'insufficient_data'
  const notes = metric.notes.filter((note) => note !== 'fewer_than_min_observations')
  const firstYear = metric.first_year
  const lastYear = metric.last_year
  return (
    <li className="py-6 first:pt-2 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-semibold">{metric.label}</h3>
        <Badge variant={metric.classification === 'insufficient_data' ? 'warning' : metric.classification === 'no_significant_trend' ? 'neutral' : 'info'}>
          {CLASSIFICATION_ICON[metric.classification]}
          {CLASSIFICATION_LABEL[metric.classification]}
        </Badge>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <p className="tabular">
          <span className="font-display text-3xl leading-none font-semibold tracking-tight">
            {hasSlope ? formatSigned(metric.slope_per_decade, 2) : '—'}
          </span>
          <span className="ml-1.5 text-sm text-muted-foreground">{metric.unit} per decade</span>
        </p>
        {/* The backend statement is deliberately cautious and already carries p, R², n and the span. */}
        <p className="text-[0.9375rem]">{statement ?? significanceText(metric, alpha)}</p>
      </div>

      <dl className="tabular mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="inline text-muted-foreground">Complete years used: </dt>
          <dd className="inline font-medium">
            {metric.n_observations}
            {firstYear !== null && lastYear !== null ? ` (${firstYear}–${lastYear})` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">R²: </dt>
          <dd className="inline font-medium">{formatNumber(metric.r_squared, 2)}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">p-value: </dt>
          <dd className="inline font-medium">{metric.p_value_supported ? formatPValue(metric.p_value) : 'not available'}</dd>
        </div>
      </dl>

      {notes.length > 0 ? (
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{describeNote(note)}</li>
          ))}
          {metric.missing_value_years.length > 0 && metric.notes.includes('event_years_only') ? (
            <li>Years without events: {metric.missing_value_years.join(', ')}.</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

export function TrendInsights({ data }: { data: HeatwaveAnalysis }) {
  const trend = data.trend
  return (
    <section id="trends" aria-labelledby="trends-heading" className="scroll-mt-20">
      <div className="flex items-center gap-1">
        <h2 id="trends-heading" className="text-xl font-semibold tracking-tight">
          Trends
        </h2>
        <InfoTip label="trends">
          Each metric is fitted with a straight line against calendar year using ordinary least squares, using complete years only. The slope is shown per decade.
        </InfoTip>
      </div>

      {trend === null ? (
        <Alert variant="info" icon={<CircleHelp />} className="mt-4">
          <AlertTitle>No trend analysis in this response</AlertTitle>
          <AlertDescription>The service returned yearly metrics without trend statistics.</AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert variant="info" icon={<Scale />} className="mt-4">
            <AlertTitle>Read trends as patterns in this data, not as proof of a cause</AlertTitle>
            <AlertDescription>
              {trend.interpretation_note} Five metrics are tested at once without correction, and they are closely related, so they are not five independent confirmations.
            </AlertDescription>
          </Alert>

          {trend.complete_years_used < trend.method.min_observations ? (
            <Alert variant="warning" icon={<TriangleAlert />} className="mt-3">
              <AlertTitle>Too few complete years for a trend</AlertTitle>
              <AlertDescription>
                {trend.complete_years_used === 0
                  ? 'No calendar year in this period is complete.'
                  : `Only ${trend.complete_years_used} complete year${trend.complete_years_used === 1 ? ' is' : 's are'} available.`}{' '}
                At least {trend.method.min_observations} are needed. Widen the period so it spans more full calendar years (1 January to 31 December).
              </AlertDescription>
            </Alert>
          ) : null}

          {trend.warnings.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
              {trend.warnings.map((code) => (
                <li key={code} className="flex gap-2">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                  <span>{describeWarning(code, data.baseline)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-5 text-sm text-muted-foreground">
            Based on {trend.complete_years_used} complete year{trend.complete_years_used === 1 ? '' : 's'}
            {trend.first_complete_year !== null && trend.last_complete_year !== null
              ? ` (${trend.first_complete_year}–${trend.last_complete_year})`
              : ''}
            . Significance level {trend.method.significance_level}. Fewer than {trend.method.low_power_observations} years gives a low-power test.
          </p>

          <ul className="mt-4 divide-y" aria-label="Trend by metric">
            {trend.metrics.map((metric) => (
              <MetricRow
                key={metric.metric}
                metric={metric}
                alpha={trend.method.significance_level}
                statement={trend.insights.find((insight) => insight.metric === metric.metric)?.statement}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
