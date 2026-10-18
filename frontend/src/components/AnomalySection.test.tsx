import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnomalySection, type AnomalyPart } from '@/components/AnomalySection'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api/errors'
import { makeAnomalies, type AnomalyFixtureOptions } from '@/test/fixtures'

const originalMatchMedia = window.matchMedia
beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as MediaQueryList) as typeof window.matchMedia
})
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function renderSection(part: AnomalyPart, onRetry = vi.fn()) {
  const view = render(
    <TooltipProvider>
      <AnomalySection part={part} onRetry={onRetry} />
    </TooltipProvider>,
  )
  return { ...view, onRetry }
}

const success = (options: AnomalyFixtureOptions = {}): AnomalyPart => ({ status: 'success', data: makeAnomalies(options) })

describe('AnomalySection with data', () => {
  it('shows the baseline, summary statistics and both charts', () => {
    const { container } = renderSection(success())
    expect(screen.getByRole('heading', { level: 2, name: 'Temperature anomalies' })).toBeInTheDocument()
    expect(screen.getByText(/A record of the past, not a forecast/)).toBeInTheDocument()

    const stats = within(container.querySelector('dl') as HTMLElement)
    expect(stats.getByText('1991–2020 baseline')).toBeInTheDocument()
    expect(stats.getByText('30.8')).toBeInTheDocument()
    expect(stats.getByText('+0.70')).toBeInTheDocument() // mean anomaly over 7 complete years
    expect(stats.getByText('average over 7 complete years')).toBeInTheDocument()
    expect(stats.getByText('2023')).toBeInTheDocument() // warmest
    expect(stats.getByText('+1.60 °C vs baseline')).toBeInTheDocument()
    expect(stats.getByText('2019')).toBeInTheDocument() // coolest
    expect(stats.getByText('−0.30 °C vs baseline')).toBeInTheDocument()
    expect(screen.getByText('5 warmer, 1 cooler and 1 equal to baseline, out of 7 complete years.')).toBeInTheDocument()

    const figures = screen.getAllByRole('figure')
    expect(figures.map((f) => f.getAttribute('aria-labelledby') && document.getElementById(f.getAttribute('aria-labelledby') as string)?.textContent)).toEqual([
      'Annual temperature anomaly(°C vs baseline)',
      'Annual mean daily maximum temperature(°C)',
    ])
    for (const figure of figures) expect(figure).toHaveAccessibleDescription()
  })

  it('draws positive and negative anomalies in different series with a zero reference line', () => {
    const { container } = renderSection(success())
    const bars = screen.getByTestId('chart-anomaly-bars')
    // 5 positive (solid) and 1 negative (hatched); the equal-to-baseline year has no bar.
    expect(bars.querySelectorAll('.recharts-bar-rectangle [fill="var(--heat)"]')).toHaveLength(5)
    expect(bars.querySelectorAll('.recharts-bar-rectangle [fill^="url(#anomaly-hatch-"]')).toHaveLength(1)
    expect(bars.querySelector('.recharts-reference-line')).not.toBeNull()
    expect(container.querySelector('pattern line')).not.toBeNull()
    // The sign is also spelled out in text, so colour and texture are never the only cue.
    expect(screen.getByText(/Solid bars above zero: warmer than the 1991–2020 baseline\. Hatched bars below zero: cooler\./)).toBeInTheDocument()
  })

  it('draws the annual mean line with a labelled baseline reference line', () => {
    renderSection(success())
    const line = screen.getByTestId('chart-anomaly-mean')
    expect(line.querySelector('.recharts-line-curve')).not.toBeNull()
    expect(line.querySelector('.recharts-reference-line')).not.toBeNull()
    expect(screen.getByRole('list', { name: 'Annual mean chart legend' })).toHaveTextContent('1991–2020 baseline mean (30.8 °C)')
    expect(screen.getByRole('list', { name: 'Anomaly bar chart legend' })).toHaveTextContent('Warmer than baseline (above zero)')
    expect(screen.getByText(/The dashed line is the 1991–2020 baseline mean daily maximum, 30\.8 °C/)).toBeInTheDocument()
  })

  it('lists every year in an accessible table, with signs and statuses', async () => {
    const user = userEvent.setup()
    renderSection(success({ lowCoverageYears: [2019], unobservedYears: [2020], partialYears: [2024] }))
    await user.click(screen.getByText('View anomalies as table'))
    const table = screen.getByRole('table', { name: /Annual mean daily maximum temperature and anomaly by year/ })
    const cells = (year: number) =>
      within(within(table).getByRole('row', { name: new RegExp(`^${year}`) })).getAllByRole('cell').map((c) => c.textContent)
    expect(cells(2018)).toEqual(['31.20', '+0.40', 'Complete year', '365/365'])
    expect(cells(2021)).toEqual(['30.80', '0.00', 'Complete year', '365/365']) // equal to baseline: a real zero
    expect(cells(2019)[1]).toBe('—') // anomaly withheld, not zero
    expect(cells(2019)[2]).toBe('Too many missing days (anomaly withheld)')
    expect(cells(2019)[0]).toBe('30.50') // the mean is still reported
    expect(cells(2020)).toEqual(['—', '—', 'No valid observations', '0/366'])
    expect(cells(2024)[2]).toBe('Partial year (anomaly withheld)')
  })

  it('says so when no year is complete instead of showing zeros', () => {
    renderSection(success({ lowCoverageYears: [2018, 2019, 2020, 2021, 2022, 2023, 2024] }))
    expect(screen.getByText(/No year in this period is complete, so no anomaly can be shown/)).toBeInTheDocument()
    const stats = within(document.querySelector('dl') as HTMLElement)
    expect(stats.getByText('No complete year in this period')).toBeInTheDocument()
    expect(stats.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByTestId('chart-anomaly-bars').querySelectorAll('.recharts-bar-rectangle')).toHaveLength(0)
  })

  it('shows data-quality warnings in plain language', () => {
    renderSection(success({ warnings: ['analysis_missing_days:12', 'years_without_anomaly:1', 'analysis_overlaps_baseline', 'baseline_year_low_coverage:2003'] }))
    const notes = screen.getByText('Data-quality notes').closest('div') as HTMLElement
    expect(within(notes).getByText(/12 days in the period have no valid temperature\. They are left out of the averages, never filled in or counted as zero/)).toBeInTheDocument()
    expect(within(notes).getByText(/1 year in the period get no anomaly/)).toBeInTheDocument()
    expect(within(notes).getByText(/overlaps the 1991–2020 baseline.*pulls their anomalies toward zero/)).toBeInTheDocument()
    expect(within(notes).getByText(/Baseline year 2003 has fewer than 90% valid days, so the baseline mean/)).toBeInTheDocument()
  })

  it('explains the method: formula, fixed baseline, not a threshold, not a forecast', async () => {
    const user = userEvent.setup()
    renderSection(success())
    await user.click(screen.getByText('How anomalies are calculated'))
    expect(screen.getByText(/Anomaly = annual mean daily maximum − baseline mean daily maximum\./)).toBeInTheDocument()
    expect(screen.getByText(/32\.4 °C against a baseline of 30\.8 °C has an anomaly of \+1\.6 °C/)).toBeInTheDocument()
    expect(screen.getByText(/different quantity from the heatwave threshold/)).toBeInTheDocument()
    expect(screen.getByText(/not the absolute hottest day of a year, and not the mean air temperature/)).toBeInTheDocument()
    expect(screen.getByText(/never filled in or counted as zero/)).toBeInTheDocument()
    expect(screen.getByText(/Anomalies describe the\s+past and are not forecasts/)).toBeInTheDocument()
  })
})

describe('AnomalySection states', () => {
  it('shows a busy status while loading', () => {
    renderSection({ status: 'loading' })
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Calculating temperature anomalies…')).toBeInTheDocument()
    expect(screen.queryAllByRole('figure')).toHaveLength(0)
  })

  it('shows the error with a retry button that calls onRetry', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderSection({ status: 'error', error: new ApiError('timeout', 'The request timed out', { status: 504 }) })
    expect(screen.getByText('Temperature anomalies could not be loaded')).toBeInTheDocument()
    expect(screen.getByText(/The analysis took too long|The request timed out/, { exact: false })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry anomalies' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
