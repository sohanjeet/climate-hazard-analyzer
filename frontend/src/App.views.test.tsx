import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import { ApiError } from '@/lib/api/errors'
import type { AnomalyRequest, HeatwaveRequest, TemperatureAnomalies } from '@/lib/api/types'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'

const NOW = new Date(2026, 9, 14)

// The sections are lazy-loaded; transforming them on first use is slow on a busy machine, so do it up front.
beforeAll(async () => {
  await Promise.all([import('@/components/ChartsSection'), import('@/components/AnomalySection'), import('@/components/compare/ComparisonCharts')])
})

function setup({
  anomalyFetcher = vi.fn(async (_r: AnomalyRequest) => makeAnomalies()),
}: { anomalyFetcher?: (r: AnomalyRequest, o: { signal: AbortSignal }) => Promise<TemperatureAnomalies> } = {}) {
  const fetcher = vi.fn(async (_r: HeatwaveRequest) => makeAnalysis())
  const comparisonFetchers = {
    heatwave: vi.fn(async () => makeAnalysis()),
    anomaly: vi.fn(async () => makeAnomalies()),
  }
  const user = userEvent.setup()
  render(<App fetcher={fetcher} anomalyFetcher={anomalyFetcher} comparisonFetchers={comparisonFetchers as unknown as ComparisonFetchers} now={NOW} />)
  return { user, fetcher, anomalyFetcher, comparisonFetchers }
}

const analyze = () => screen.getByRole('button', { name: /analyze heatwaves/i })

describe('anomalies in the single-location view', () => {
  it('requests anomalies for the same location and period as the heatwave analysis', async () => {
    const { user, fetcher, anomalyFetcher } = setup()
    await user.click(analyze())
    expect(await screen.findByRole('heading', { name: 'Temperature anomalies' })).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [request] = (anomalyFetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [AnomalyRequest]
    expect(request).toEqual({ latitude: 28.6139, longitude: 77.209, startDate: '2010-01-01', endDate: '2025-12-31' })
    expect(await screen.findByTestId('chart-anomaly-bars')).toBeInTheDocument()
    expect(document.getElementById('anomalies')).not.toBeNull()
    // The section sits between the charts and the trends in the page order and the navigation.
    const ids = Array.from(document.querySelectorAll('main section[id]')).map((s) => s.id)
    expect(ids.indexOf('charts')).toBeLessThan(ids.indexOf('anomalies'))
    expect(ids.indexOf('anomalies')).toBeLessThan(ids.indexOf('trends'))
  })

  it('keeps the heatwave results when anomalies fail, and retries only the anomalies', async () => {
    let attempts = 0
    const anomalyFetcher = vi.fn(async (_r: AnomalyRequest) => {
      attempts += 1
      if (attempts === 1) throw new ApiError('upstream', 'Open-Meteo request failed', { status: 502 })
      return makeAnomalies()
    })
    const { user, fetcher } = setup({ anomalyFetcher })
    await user.click(analyze())
    expect(await screen.findByText('Temperature anomalies could not be loaded')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Methodology' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry anomalies' }))
    expect(await screen.findByTestId('chart-anomaly-bars')).toBeInTheDocument()
    expect(anomalyFetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('switching between analyzing and comparing', () => {
  it('shows the view switcher with the current view marked', () => {
    setup()
    const views = screen.getByRole('navigation', { name: 'Views' })
    expect(within(views).getByRole('button', { name: 'Analyze' })).toHaveAttribute('aria-current', 'page')
    expect(within(views).getByRole('button', { name: 'Compare' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('heading', { name: 'Compare locations' })).toBeNull() // not mounted until opened
  })

  it('opens the comparison, runs it, and keeps the result when switching back and forth', async () => {
    const { user, comparisonFetchers } = setup()
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1, name: 'Compare locations' })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: 'Heatwave Trend Analyzer' })).toBeNull() // hidden, so not exposed

    await user.click(screen.getByRole('button', { name: 'Compare locations' }))
    await waitFor(() => expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(2))
    expect(comparisonFetchers.heatwave).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Analyze' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Heatwave Trend Analyzer' })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: 'Compare locations' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(2) // still there
    expect(comparisonFetchers.heatwave).toHaveBeenCalledTimes(2) // and not fetched again
  })

  it('points the skip link at the visible results area', async () => {
    const { user } = setup()
    expect(screen.getByRole('link', { name: 'Skip to results' })).toHaveAttribute('href', '#results')
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByRole('link', { name: 'Skip to results' })).toHaveAttribute('href', '#compare-results')
  })

  it('hides the analyzer result navigation while comparing', async () => {
    const { user } = setup()
    await user.click(analyze())
    await screen.findByRole('heading', { name: 'Temperature anomalies' })
    expect(screen.getByRole('navigation', { name: 'Result sections' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.queryByRole('navigation', { name: 'Result sections' })).toBeNull()
  })
})
