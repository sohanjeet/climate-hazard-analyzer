import { CloudOff, Gauge, LoaderCircle, SearchX, ServerCrash, ShieldAlert, TimerOff, Waves } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError, ApiError, type ApiErrorKind } from '@/lib/api/errors'
import { useElapsedSeconds } from '@/hooks/useHeatwaveAnalysis'

export function EmptyState() {
  return (
    <section aria-labelledby="empty-heading" className="rounded-lg border border-dashed px-6 py-12 sm:px-10">
      <Waves aria-hidden="true" className="size-8 text-heat" />
      <h2 id="empty-heading" className="mt-4 text-xl font-semibold tracking-tight">
        Pick a place and a period to begin
      </h2>
      <p className="mt-2 max-w-prose text-[0.9375rem] text-muted-foreground">
        The analysis finds every run of at least 3 days hotter than the location’s usual 95th-percentile day over 1991 to 2020, then shows how their number, length and intensity changed year by year.
      </p>
      <ol className="mt-5 flex max-w-prose list-decimal flex-col gap-1.5 pl-5 text-[0.9375rem] text-muted-foreground">
        <li>Enter coordinates, or choose one of the example locations.</li>
        <li>Choose a period of several full calendar years. Trends need at least 3.</li>
        <li>Run the analysis. A new location can take 5 to 15 seconds the first time.</li>
      </ol>
    </section>
  )
}

const LOADING_STAGES = [
  { after: 0, text: 'Sending the request' },
  { after: 3, text: 'Loading the 30-year baseline for this location' },
  { after: 12, text: 'Still loading the baseline; a new location can take up to 15 seconds' },
  { after: 25, text: 'Taking longer than usual. The weather archive may be slow right now' },
] as const

export function LoadingState({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const elapsed = useElapsedSeconds(startedAt) ?? 0
  const stage = [...LOADING_STAGES].reverse().find((s) => elapsed >= s.after) ?? LOADING_STAGES[0]

  return (
    <div aria-busy="true" className="flex flex-col gap-10">
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-surface px-5 py-4">
        <LoaderCircle aria-hidden="true" className="size-5 shrink-0 text-primary motion-safe:animate-spin" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Analyzing heatwaves…</p>
          <p className="text-sm text-muted-foreground">{stage.text}.</p>
        </div>
        <p className="tabular text-sm text-muted-foreground" aria-hidden="true">
          {elapsed}s
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-md px-3 text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          Cancel
        </button>
      </div>

      <div className="@container">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 border-y py-7 @2xl:grid-cols-3 @4xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={i === 0 ? 'col-span-2 @2xl:col-span-1' : undefined}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-10 w-20" />
              <Skeleton className="mt-3 h-4 w-32" />
            </div>
          ))}
        </div>
      </div>

      <ChartsFallback />
    </div>
  )
}

/** Chart-shaped placeholders: shown while loading and while the chart code itself is still downloading. */
export function ChartsFallback() {
  return (
    <div className="grid gap-10 xl:grid-cols-2" data-testid="charts-fallback">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i}>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-4 h-60 w-full sm:h-64" />
          <Skeleton className="mt-3 h-4 w-3/4" />
        </div>
      ))}
    </div>
  )
}

const ERROR_ICON: Record<ApiErrorKind, React.ReactNode> = {
  validation: <SearchX />,
  rate_limited: <Gauge />,
  unavailable: <ServerCrash />,
  timeout: <TimerOff />,
  upstream: <CloudOff />,
  server: <ServerCrash />,
  network: <CloudOff />,
  invalid_response: <ShieldAlert />,
  http: <ShieldAlert />,
  aborted: <CloudOff />,
}

export function ErrorState({
  error,
  cooldownSeconds,
  onRetry,
}: {
  error: ApiError
  cooldownSeconds: number
  onRetry: () => void
}) {
  const presentation = describeError(error)
  // The backend's own message is the most specific thing we have; show it unless it just repeats the status.
  const detail = error.kind === 'network' ? null : error.message

  return (
    <Alert variant="danger" icon={ERROR_ICON[error.kind]} role="alert" className="p-5">
      <AlertTitle className="text-base">{presentation.title}</AlertTitle>
      <AlertDescription>
        <p>{presentation.description}</p>
        {detail ? (
          <p className="mt-2 text-foreground">
            <span className="font-semibold">Details: </span>
            {detail}
          </p>
        ) : null}
        {error.fieldErrors.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-foreground">
            {error.fieldErrors.map((fe) => (
              <li key={`${fe.field}-${fe.message}`}>
                <span className="font-semibold">{fe.field || 'request'}:</span> {fe.message}
              </li>
            ))}
          </ul>
        ) : null}
        {presentation.retryable ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              disabled={cooldownSeconds > 0}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : 'Try again'}
            </button>
            {cooldownSeconds > 0 ? (
              <span className="text-sm text-foreground">The service asked clients to wait before retrying.</span>
            ) : null}
          </div>
        ) : null}
        {error.requestId ? (
          <p className="mt-3 text-xs text-muted-foreground">Request ID {error.requestId}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
