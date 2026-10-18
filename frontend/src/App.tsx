import { Suspense, lazy, useEffect, useMemo, useRef } from 'react'
import { AnalysisForm } from '@/components/AnalysisForm'
import { AppHeader, type NavSection } from '@/components/AppHeader'
import { DataQuality } from '@/components/DataQuality'
import { Methodology } from '@/components/Methodology'
import { ResultsHeader } from '@/components/ResultsHeader'
import { ChartsFallback, EmptyState, ErrorState, LoadingState } from '@/components/StatePanels'
import { SummaryMetrics } from '@/components/SummaryMetrics'
import { TrendInsights } from '@/components/TrendInsights'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCountdown, useHeatwaveAnalysis } from '@/hooks/useHeatwaveAnalysis'
import { useSystemTheme } from '@/hooks/useMediaQuery'
import { fetchHeatwaves } from '@/lib/api/client'
import type { HeatwaveRequest } from '@/lib/api/types'
import { formatInteger } from '@/lib/format'
import { formFieldForApiField, formFieldForMessage, type FormErrors } from '@/lib/validation'

// Recharts is the bulk of the bundle and is only needed once there are results.
const ChartsSection = lazy(() => import('@/components/ChartsSection').then((m) => ({ default: m.ChartsSection })))

const RESULT_SECTIONS: NavSection[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'charts', label: 'Charts' },
  { id: 'trends', label: 'Trends' },
  { id: 'quality', label: 'Data quality' },
  { id: 'method', label: 'Method' },
]

/** Height of the sticky header plus breathing room; a heading above this line counts as hidden. */
const HEADER_CLEARANCE_PX = 72

const NO_SECTIONS: NavSection[] = []

type Fetcher = Parameters<typeof useHeatwaveAnalysis>[0]

export default function App({ fetcher = fetchHeatwaves, now }: { fetcher?: Fetcher; now?: Date }) {
  useSystemTheme()
  const { state, run, cancel } = useHeatwaveAnalysis(fetcher)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const cooldownSeconds = useCountdown(state.status === 'error' ? state.retryAt : null)

  const serverErrors = useMemo<FormErrors>(() => {
    if (state.status !== 'error' || state.error.kind !== 'validation') return {}
    const errors: FormErrors = {}
    for (const fe of state.error.fieldErrors) {
      const field = formFieldForApiField(fe.field)
      if (field && !errors[field]) errors[field] = fe.message
    }
    if (Object.keys(errors).length === 0) {
      const field = formFieldForMessage(state.error.message)
      if (field) errors[field] = state.error.message
    }
    return errors
  }, [state])

  // When a run finishes, bring its outcome into view if it is above the fold or tucked under the sticky header.
  // Successful results also take keyboard focus so keyboard and screen-reader users land on them.
  useEffect(() => {
    if (state.status !== 'success' && state.status !== 'error') return
    if (state.status === 'error' && state.error.kind === 'validation') return // focus moves to the offending field
    const target = state.status === 'success' ? headingRef.current : resultsRef.current
    if (!target) return
    if (state.status === 'success') target.focus({ preventScroll: true })
    const { top, bottom } = target.getBoundingClientRect()
    if (top < HEADER_CLEARANCE_PX || bottom > window.innerHeight) {
      target.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    }
  }, [state])

  const announcement =
    state.status === 'loading'
      ? 'Analyzing heatwaves. This can take up to 15 seconds for a new location.'
      : state.status === 'success'
        ? `Analysis complete: ${formatInteger(state.data.summary.total_events)} heatwave events found.`
        : ''

  function startRun(request: HeatwaveRequest) {
    void run(request)
  }

  return (
    <TooltipProvider>
      <a
        href="#results"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to results
      </a>
      <AppHeader sections={state.status === 'success' ? RESULT_SECTIONS : NO_SECTIONS} />

      <main id="top" className="mx-auto max-w-[88rem] px-4 pt-8 pb-20 sm:px-6 sm:pt-12 lg:px-8">
        <div className="max-w-3xl">
          <h1 className="font-display text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            Heatwave Trend Analyzer
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            See how often heatwaves struck a place, how long they lasted and how intense they were, year by year, measured against a fixed 1991–2020 baseline. Trend statistics and data-quality checks come with every result.
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[21.5rem_minmax(0,1fr)] lg:items-start lg:gap-12">
          <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <div className="rounded-lg border bg-surface p-5">
              <AnalysisForm
                onSubmit={startRun}
                onCancel={cancel}
                busy={state.status === 'loading'}
                cooldownSeconds={cooldownSeconds}
                serverErrors={serverErrors}
                now={now}
              />
            </div>
          </aside>

          <div id="results" ref={resultsRef} tabIndex={-1} className="flex min-w-0 scroll-mt-20 flex-col gap-14 outline-none">
            <div role="status" aria-live="polite" className="sr-only">
              {announcement}
            </div>

            {state.status === 'idle' ? <EmptyState /> : null}
            {state.status === 'loading' ? <LoadingState startedAt={state.startedAt} onCancel={cancel} /> : null}
            {state.status === 'error' ? (
              <ErrorState error={state.error} cooldownSeconds={cooldownSeconds} onRetry={() => startRun(state.request)} />
            ) : null}
            {state.status === 'success' ? (
              <>
                <ResultsHeader ref={headingRef} data={state.data} />
                <SummaryMetrics data={state.data} />
                <Suspense fallback={<ChartsFallback />}>
                  <ChartsSection data={state.data} />
                </Suspense>
                <TrendInsights data={state.data} />
                <DataQuality data={state.data} />
                <Methodology data={state.data} />
              </>
            ) : null}
          </div>
        </div>
      </main>
    </TooltipProvider>
  )
}
