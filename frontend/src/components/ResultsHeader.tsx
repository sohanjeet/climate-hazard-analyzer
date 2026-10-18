import { forwardRef } from 'react'
import { Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { HeatwaveAnalysis } from '@/lib/api/types'
import { formatCoordinates, formatDate, formatDateTime } from '@/lib/format'

export const ResultsHeader = forwardRef<HTMLHeadingElement, { data: HeatwaveAnalysis }>(function ResultsHeader(
  { data },
  ref,
) {
  const noEvents = data.summary.total_events === 0
  return (
    <div>
      <h2 ref={ref} tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-semibold tracking-tight outline-none sm:text-3xl">
        Heatwaves near {formatCoordinates(data.latitude, data.longitude)}
      </h2>
      <p className="tabular mt-1 text-[0.9375rem] text-muted-foreground">
        {formatDate(data.start_date)} to {formatDate(data.end_date)} · baseline {data.baseline.start_year}–{data.baseline.end_year} · computed {formatDateTime(data.computed_at)}
      </p>
      {noEvents ? (
        <Alert variant="info" icon={<Info />} className="mt-5">
          <AlertTitle>No heatwaves in this period</AlertTitle>
          <AlertDescription>
            No run of {data.method.min_duration_days} or more days exceeded the {data.baseline.threshold_c.toFixed(1)} °C threshold. That is a valid result, not an error. Charts show zero events, while mean duration and intensity are undefined without events. Missing data would make this a lower bound, so check Data quality below.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
})
