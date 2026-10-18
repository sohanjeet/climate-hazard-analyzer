import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DataQuality } from '@/components/DataQuality'
import { Methodology } from '@/components/Methodology'
import { SummaryMetrics } from '@/components/SummaryMetrics'
import { TrendInsights } from '@/components/TrendInsights'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeAnalysis, type FixtureOptions } from '@/test/fixtures'

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe('SummaryMetrics', () => {
  it('shows the five requested metrics with their values', () => {
    wrap(<SummaryMetrics data={makeAnalysis()} />)
    const data = makeAnalysis()
    const stat = (name: string) => screen.getByText(name, { selector: 'dt' }).closest('div')!
    expect(stat('Heatwave events')).toHaveTextContent(String(data.summary.total_events))
    expect(stat('Heatwave days')).toHaveTextContent(String(data.summary.total_heatwave_days))
    expect(stat('Mean event duration')).toHaveTextContent('days')
    expect(stat('Maximum intensity')).toHaveTextContent('+4.5')
    expect(stat('Baseline threshold')).toHaveTextContent('39.6')
    expect(stat('Baseline threshold')).toHaveTextContent('1991–2020')
  })

  it('shows dashes, not zeros, for undefined metrics when there are no events', () => {
    wrap(<SummaryMetrics data={makeAnalysis({ noEvents: true })} />)
    const stat = (name: string) => screen.getByText(name, { selector: 'dt' }).closest('div')!
    expect(stat('Heatwave events')).toHaveTextContent('0')
    expect(stat('Mean event duration')).toHaveTextContent('—')
    expect(stat('Maximum intensity')).toHaveTextContent('—')
    expect(stat('Maximum intensity')).toHaveTextContent('No events in this period')
  })

  it('explains each metric through a keyboard-reachable tooltip', async () => {
    wrap(<SummaryMetrics data={makeAnalysis()} />)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'About baseline threshold' })
    expect(trigger.tagName).toBe('BUTTON') // a real button, so it is in the tab order
    await user.hover(trigger)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/95th percentile of daily maximum temperature over 1991 to 2020/)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })
})

describe('TrendInsights', () => {
  it('shows slope per decade, classification and cautious significance wording', () => {
    wrap(<TrendInsights data={makeAnalysis()} />)
    const list = screen.getByRole('list', { name: 'Trend by metric' })
    expect(within(list).getAllByText('+1.20').length).toBe(5)
    expect(within(list).getAllByText('Increasing').length).toBe(2)
    expect(within(list).getAllByText('No significant trend').length).toBe(3)
    expect(list).toHaveTextContent('statistically significant linear increase')
    expect(list).toHaveTextContent('This does not show that no change occurred.')
    expect(list).toHaveTextContent('Complete years used: 7 (2018–2024)')
  })

  it('never claims causation and says so up front', () => {
    wrap(<TrendInsights data={makeAnalysis()} />)
    expect(screen.getByText(/not as proof of a cause/i)).toBeInTheDocument()
    expect(screen.getByText(/does not by itself establish the cause/i)).toBeInTheDocument()
    expect(screen.queryByText(/caused by|because of climate|proves/i)).toBeNull()
  })

  it('explains low statistical power and event-years-only caveats', () => {
    wrap(<TrendInsights data={makeAnalysis()} />)
    expect(screen.getAllByText(/Fewer than 10 yearly observations/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Years without events are left out, not counted as zero/).length).toBe(3)
    expect(screen.getAllByText(/Years without events: 2018\./).length).toBe(3)
  })

  it('explains insufficient observations instead of showing numbers', () => {
    wrap(<TrendInsights data={makeAnalysis({ trend: 'insufficient' })} />)
    expect(screen.getByText('Too few complete years for a trend')).toBeInTheDocument()
    expect(screen.getAllByText('Not enough data').length).toBe(5)
    expect(screen.getAllByText(/insufficient data/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('+1.20')).toBeNull()
  })

  it('handles a response without a trend block', () => {
    wrap(<TrendInsights data={makeAnalysis({ trend: 'none' })} />)
    expect(screen.getByText('No trend analysis in this response')).toBeInTheDocument()
  })
})

describe('DataQuality', () => {
  const renderQuality = (options: FixtureOptions) => wrap(<DataQuality data={makeAnalysis(options)} />)

  it('states that nothing is missing when the data are clean', () => {
    renderQuality({})
    expect(screen.getByText('No data gaps detected')).toBeInTheDocument()
    expect(screen.getByText('1991–2020')).toBeInTheDocument()
  })

  it('lists missing dates as ranges, plus warnings in plain language', async () => {
    renderQuality({
      missingDates: ['2021-03-04', '2021-03-05', '2021-03-06', '2022-07-01'],
      warnings: ['analysis_missing_days:4', 'analysis_overlaps_baseline'],
      baselineLowCoverageYears: [1999],
    })
    expect(screen.queryByText('No data gaps detected')).toBeNull()
    expect(screen.getByText(/4 days in the analysis window have no valid temperature/)).toBeInTheDocument()
    expect(screen.getByText(/overlaps the 1991–2020 baseline/)).toBeInTheDocument()
    expect(screen.getByText(/1999\. The threshold rests on less data/)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/Show the 2 missing date ranges/))
    expect(screen.getByText(/4 Mar 2021 to 6 Mar 2021/)).toBeInTheDocument()
    expect(screen.getByText(/1 Jul 2022/)).toBeInTheDocument()
  })

  it('explains incomplete years and why each one is incomplete', () => {
    renderQuality({ incompleteYears: [2024] })
    expect(screen.getByText('Why some years are incomplete')).toBeInTheDocument()
    expect(screen.getByText(/lies wholly inside the period you chose/)).toBeInTheDocument()
    expect(screen.getByText(/2024/, { selector: 'span.font-semibold' })).toBeInTheDocument()
    expect(screen.getByText(/too many days are missing/)).toBeInTheDocument()
  })
})

describe('Methodology', () => {
  it('describes event-start-year attribution and the missing-day policy', () => {
    wrap(<Methodology data={makeAnalysis()} />)
    expect(screen.getByText('Which year an event belongs to')).toBeInTheDocument()
    expect(screen.getByText(/The year in which it starts\./)).toBeInTheDocument()
    expect(screen.getByText(/Never filled in or estimated/)).toBeInTheDocument()
    expect(screen.getByText(/Open-Meteo historical archive/)).toHaveTextContent('28.614°N, 77.209°E')
  })
})
