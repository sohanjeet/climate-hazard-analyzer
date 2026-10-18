import { CircleCheck, TriangleAlert } from 'lucide-react'
import { InfoTip } from '@/components/InfoTip'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { HeatwaveAnalysis } from '@/lib/api/types'
import { describeWarning, formatDate, formatInteger, formatPercent, groupDateRanges } from '@/lib/format'

const MAX_LISTED_RANGES = 50

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

export function DataQuality({ data }: { data: HeatwaveAnalysis }) {
  const { baseline, data_quality: quality, annual, events, method } = data
  const incompleteYears = annual.filter((year) => !year.is_complete)
  const missingRanges = groupDateRanges(quality.missing_dates)
  const censored = events.filter((event) => event.censored_start || event.censored_end).length
  const nearGaps = events.filter((event) => event.adjacent_missing).length
  const hasMissing = quality.missing_dates.length > 0
  const warnings = quality.warnings.filter((code) => !code.startsWith('baseline_year_low_coverage'))
  const clean = !hasMissing && warnings.length === 0 && incompleteYears.length === 0 && baseline.low_coverage_years.length === 0

  return (
    <section id="quality" aria-labelledby="quality-heading" className="scroll-mt-20">
      <div className="flex items-center gap-1">
        <h2 id="quality-heading" className="text-xl font-semibold tracking-tight">
          Data quality
        </h2>
        <InfoTip label="data quality">
          Missing days are never filled in or estimated. A missing day ends any run of hot days, so event counts can only be too low where data are missing, never too high.
        </InfoTip>
      </div>

      {clean ? (
        <Alert variant="info" icon={<CircleCheck />} className="mt-4">
          <AlertTitle>No data gaps detected</AlertTitle>
          <AlertDescription>
            Every day in the period has a valid temperature, every year is complete and the baseline has no low-coverage years.
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="mt-5 grid gap-x-10 gap-y-5 text-[0.9375rem] sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Baseline period</dt>
          <dd className="tabular mt-0.5">
            {baseline.start_year}–{baseline.end_year}
            <span className="text-muted-foreground">
              {' '}
              · {formatPercent(baseline.coverage)} of days valid ({formatInteger(baseline.observation_count)} of {formatInteger(baseline.expected_count)})
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Analysis period coverage</dt>
          <dd className="tabular mt-0.5">
            {formatPercent(quality.analysis_coverage)}
            <span className="text-muted-foreground">
              {' '}
              · {formatDate(data.start_date)} to {formatDate(data.end_date)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Missing days</dt>
          <dd className="tabular mt-0.5">
            {hasMissing ? `${formatInteger(quality.missing_dates.length)} in the analysis period` : 'None'}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Incomplete years</dt>
          <dd className="tabular mt-0.5">
            {incompleteYears.length === 0 ? 'None' : `${incompleteYears.length} of ${annual.length}`}
          </dd>
        </div>
        {events.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-muted-foreground">Events touching a data edge</dt>
            <dd className="mt-0.5">
              {censored === 0 && nearGaps === 0
                ? 'No event starts or ends at the edge of the period or next to a missing day.'
                : [
                    censored > 0 ? `${censored} start${censored === 1 ? 's' : ''} or end${censored === 1 ? 's' : ''} at the edge of the period, so ${censored === 1 ? 'it' : 'they'} may really be longer` : null,
                    nearGaps > 0 ? `${nearGaps} sit${nearGaps === 1 ? 's' : ''} next to a missing day` : null,
                  ]
                    .filter(Boolean)
                    .join('; ') + '.'}
            </dd>
          </div>
        ) : null}
      </dl>

      {warnings.length > 0 || baseline.low_coverage_years.length > 0 ? (
        <Alert variant="warning" icon={<TriangleAlert />} className="mt-6">
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              {warnings.map((code) => (
                <li key={code}>{describeWarning(code, baseline)}</li>
              ))}
              {baseline.low_coverage_years.length > 0 ? (
                <li>
                  Baseline {baseline.low_coverage_years.length === 1 ? 'year' : 'years'} with fewer than {formatPercent(method.baseline_min_coverage, 0)} valid days: {baseline.low_coverage_years.join(', ')}. The threshold rests on less data from {baseline.low_coverage_years.length === 1 ? 'that year' : 'those years'}.
                </li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {incompleteYears.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-base font-semibold">Why some years are incomplete</h3>
          <p className="mt-1 max-w-prose text-[0.9375rem] text-muted-foreground">
            A year is complete only if it lies wholly inside the period you chose (1 January to 31 December) and at least {formatPercent(method.year_min_coverage, 0)} of its days have valid data. Incomplete years are charted with hatching, but kept out of trends and rolling averages because they would understate the year.
          </p>
          <ul className="tabular mt-3 flex flex-col gap-1 text-sm">
            {incompleteYears.map((year) => (
              <li key={year.year}>
                <span className="font-semibold">{year.year}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {year.days_observed} of {year.days_expected} days observed ({formatPercent(year.coverage, 0)})
                  {year.days_expected < daysInYear(year.year)
                    ? ': only part of this year is inside the period'
                    : ': too many days are missing'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasMissing ? (
        <details className="mt-6 text-sm">
          <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-md font-medium text-primary underline-offset-4 hover:underline">
            Show the {missingRanges.length} missing date range{missingRanges.length === 1 ? '' : 's'}
          </summary>
          <ul className="tabular mt-2 max-h-60 overflow-auto rounded-md border p-3">
            {missingRanges.slice(0, MAX_LISTED_RANGES).map((range) => (
              <li key={range.start} className="py-0.5">
                {range.days === 1 ? formatDate(range.start) : `${formatDate(range.start)} to ${formatDate(range.end)}`}
                <span className="text-muted-foreground"> · {range.days} day{range.days === 1 ? '' : 's'}</span>
              </li>
            ))}
            {missingRanges.length > MAX_LISTED_RANGES ? (
              <li className="pt-2 text-muted-foreground">…and {missingRanges.length - MAX_LISTED_RANGES} more ranges.</li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
