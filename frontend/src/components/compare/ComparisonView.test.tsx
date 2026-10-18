import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComparisonView } from '@/components/compare/ComparisonView'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import { ApiError } from '@/lib/api/errors'
import type { AnomalyRequest, HeatwaveAnalysis, HeatwaveRequest, TemperatureAnomalies } from '@/lib/api/types'
import { makeAnalysis, makeAnomalies, type AnomalyFixtureOptions, type FixtureOptions } from '@/test/fixtures'

// 14 Oct 2026 -> the archive ends 9 Oct 2026 and the default period is 2010-01-01 to 2025-12-31.
const NOW = new Date(2026, 9, 14)
const DELHI = { latitude: 28.6139, longitude: 77.209 }
const MUMBAI = { latitude: 19.076, longitude: 72.8777 }

// The charts are lazy-loaded; transform them up front so a busy machine cannot time out the first test.
beforeAll(async () => {
  await import('@/components/compare/ComparisonCharts')
})

const originalMatchMedia = window.matchMedia
beforeEach(() => {
  // Reduced motion draws charts in their final state at once.
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

type HeatwaveHandler = (request: HeatwaveRequest) => Promise<HeatwaveAnalysis>
type AnomalyHandler = (request: AnomalyRequest) => Promise<TemperatureAnomalies>

const sameCity = (request: { latitude: number }, city: { latitude: number }) => Math.abs(request.latitude - city.latitude) < 1e-6

/** Fixtures that differ per city so the table can show them apart. */
function okHeatwave(request: HeatwaveRequest, overrides: Record<string, FixtureOptions> = {}): Promise<HeatwaveAnalysis> {
  const key = sameCity(request, DELHI) ? 'delhi' : sameCity(request, MUMBAI) ? 'mumbai' : 'other'
  return Promise.resolve(makeAnalysis({ latitude: request.latitude, longitude: request.longitude, ...overrides[key] }))
}

function okAnomaly(request: AnomalyRequest, overrides: Record<string, AnomalyFixtureOptions> = {}): Promise<TemperatureAnomalies> {
  const key = sameCity(request, DELHI) ? 'delhi' : sameCity(request, MUMBAI) ? 'mumbai' : 'other'
  const shift = key === 'mumbai' ? -0.5 : 0
  return Promise.resolve(makeAnomalies({ latitude: request.latitude, longitude: request.longitude, shift, ...overrides[key] }))
}

function setup(heatwave: HeatwaveHandler = okHeatwave, anomaly: AnomalyHandler = okAnomaly) {
  const fetchers = {
    heatwave: vi.fn((request: HeatwaveRequest) => heatwave(request)),
    anomaly: vi.fn((request: AnomalyRequest) => anomaly(request)),
  }
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <ComparisonView fetchers={fetchers as unknown as ComparisonFetchers} now={NOW} />
    </TooltipProvider>,
  )
  return { fetchers, user }
}

const compareButton = () => screen.getByRole('button', { name: /compare locations|comparing/i })
const selectedList = () => within(screen.getByRole('region', { name: /selected locations/i, hidden: false }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function addCustom(user: ReturnType<typeof userEvent.setup>, latitude: string, longitude: string, name = '') {
  for (const label of ['Name (optional)', 'Custom latitude', 'Custom longitude']) await user.clear(screen.getByLabelText(label))
  if (name) await user.type(screen.getByLabelText('Name (optional)'), name)
  await user.type(screen.getByLabelText('Custom latitude'), latitude)
  await user.type(screen.getByLabelText('Custom longitude'), longitude)
  await user.click(screen.getByRole('button', { name: 'Add location' }))
}

describe('location selection', () => {
  it('starts with two presets and labelled controls', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Compare locations' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Delhi/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Mumbai/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Bengaluru/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Chennai/ })).not.toBeChecked()
    expect(screen.getByLabelText('Start date')).toHaveValue('2010-01-01')
    expect(screen.getByLabelText('End date')).toHaveValue('2025-12-31')
    expect(screen.getByLabelText('Custom latitude')).toBeInTheDocument()
    expect(screen.getByLabelText('Custom longitude')).toBeInTheDocument()
    expect(screen.getByLabelText('Name (optional)')).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Comparison controls' })).toBeInTheDocument()
    expect(screen.getByText(/2 of 4; choose 2 to 4/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Choose two to four locations to compare' })).toBeInTheDocument()
  })

  it('adds a preset by checking it and removes it with the Remove button', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('checkbox', { name: /Bengaluru/ }))
    expect(selectedList().getByText('Bengaluru')).toBeInTheDocument()
    expect(screen.getByText(/3 of 4/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Delhi' }))
    expect(selectedList().queryByText('Delhi')).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Delhi/ })).not.toBeChecked()
    expect(screen.getByText(/2 of 4/)).toBeInTheDocument()
  })

  it('unchecking a preset removes it too', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('checkbox', { name: /Mumbai/ }))
    expect(selectedList().queryByText('Mumbai')).toBeNull()
  })

  it('adds a custom location with valid coordinates and clears the inputs', async () => {
    const { user } = setup()
    await addCustom(user, '51.5074', '-0.1278', 'London')
    expect(selectedList().getByText('London')).toBeInTheDocument()
    expect(screen.getByLabelText('Custom latitude')).toHaveValue('')
    expect(screen.getByText(/3 of 4/)).toBeInTheDocument()
  })

  it('adds the custom location on Enter without starting the comparison, and never nests forms', async () => {
    const { user, fetchers } = setup()
    expect(document.querySelectorAll('form form')).toHaveLength(0)
    await user.type(screen.getByLabelText('Custom latitude'), '51.5074')
    await user.type(screen.getByLabelText('Custom longitude'), '-0.1278{Enter}')
    expect(selectedList().getByText(/Custom \(51\.507°N, 0\.128°W\)/)).toBeInTheDocument()
    expect(fetchers.heatwave).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Add a custom location' })).toBeInTheDocument()
  })

  it.each([
    ['91', '10', /Latitude must be between -90 and 90/],
    ['10', '181', /Longitude must be between -180 and 180/],
    ['north', '10', /Latitude must be a number/],
    ['', '', /Enter a latitude/],
  ])('rejects custom coordinates %s, %s with an accessible message', async (latitude, longitude, message) => {
    const { user } = setup()
    if (latitude) await user.type(screen.getByLabelText('Custom latitude'), latitude)
    if (longitude) await user.type(screen.getByLabelText('Custom longitude'), longitude)
    await user.click(screen.getByRole('button', { name: 'Add location' }))
    expect(screen.getAllByRole('alert').some((el) => message.test(el.textContent ?? ''))).toBe(true)
    expect(screen.getByLabelText('Custom latitude').getAttribute('aria-invalid') === 'true' || screen.getByLabelText('Custom longitude').getAttribute('aria-invalid') === 'true').toBe(true)
    expect(screen.getByText(/2 of 4/)).toBeInTheDocument()
  })

  it('prevents duplicate coordinates, also against a preset', async () => {
    const { user } = setup()
    await addCustom(user, '28.6139', '77.2090', 'Dilli')
    expect(screen.getByText(/Delhi already uses these coordinates/)).toBeInTheDocument()
    expect(selectedList().queryByText('Dilli')).toBeNull()
    expect(screen.getByText(/2 of 4/)).toBeInTheDocument()
  })

  it('allows at most four locations', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('checkbox', { name: /Bengaluru/ }))
    await user.click(screen.getByRole('checkbox', { name: /Chennai/ }))
    expect(screen.getByText(/4 of 4/)).toBeInTheDocument()

    await addCustom(user, '18.5204', '73.8567', 'Pune')
    expect(screen.getByText(/at most 4 locations/)).toBeInTheDocument()
    expect(selectedList().queryByText('Pune')).toBeNull()
    expect(selectedList().getAllByRole('listitem')).toHaveLength(4)

    await user.click(screen.getByRole('button', { name: 'Remove Chennai' }))
    await addCustom(user, '18.5204', '73.8567', 'Pune')
    expect(selectedList().getByText('Pune')).toBeInTheDocument()
  })

  it('requires at least two locations before running', async () => {
    const { user, fetchers } = setup()
    await user.click(screen.getByRole('button', { name: 'Remove Delhi' }))
    await user.click(compareButton())
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least 2 locations to compare.')
    expect(fetchers.heatwave).not.toHaveBeenCalled()
  })

  it('validates the shared date range', async () => {
    const { user, fetchers } = setup()
    const end = screen.getByLabelText('End date')
    await user.clear(end)
    await user.type(end, '2009-12-31')
    await user.click(compareButton())
    expect(screen.getByText('The end date must be on or after the start date.')).toBeInTheDocument()
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(fetchers.heatwave).not.toHaveBeenCalled()
  })
})

describe('running a comparison', () => {
  it('sends the same period to every location and shows summary, table and three charts', async () => {
    const { user, fetchers } = setup()
    await user.click(compareButton())

    expect(await screen.findByRole('heading', { name: 'Side by side' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(2))

    const calls = fetchers.heatwave.mock.calls.map(([r]) => r)
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call).toMatchObject({ startDate: '2010-01-01', endDate: '2025-12-31' })
    expect(calls.map((c) => c.latitude).sort()).toEqual([19.076, 28.6139])
    expect(fetchers.anomaly.mock.calls.map(([r]) => [r.startDate, r.endDate])).toEqual([
      ['2010-01-01', '2025-12-31'],
      ['2010-01-01', '2025-12-31'],
    ])

    const table = screen.getByRole('table', { name: /Heatwave and temperature metrics/ })
    expect(within(table).getByRole('columnheader', { name: /Delhi/ })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Mumbai/ })).toBeInTheDocument()
    const eventsRow = within(table).getByRole('row', { name: /Heatwave events/ })
    expect(within(eventsRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['13', '13'])
    const anomalyRow = within(table).getByRole('row', { name: /Mean temperature anomaly/ })
    expect(within(anomalyRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['+0.70', '+0.20'])

    expect(await screen.findByTestId('compare-chart-heatwave_days')).toBeInTheDocument()
    expect(screen.getByTestId('compare-chart-mean_daily_max')).toBeInTheDocument()
    expect(screen.getByTestId('compare-chart-anomaly')).toBeInTheDocument()
    expect(screen.getAllByRole('figure')).toHaveLength(3)
    const legend = screen.getByRole('list', { name: 'Heatwave days per year legend' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Delhi(circle, solid line)',
      'Mumbai(square, dashed line)',
    ])
  })

  it('draws one line per location in each chart', async () => {
    const { user } = setup()
    await user.click(compareButton())
    const chart = await screen.findByTestId('compare-chart-heatwave_days')
    await waitFor(() => expect(chart.querySelectorAll('.recharts-line')).toHaveLength(2))
    expect(chart.querySelectorAll('.recharts-line-curve')).toHaveLength(2)
  })

  it('keeps a plotted zero for a complete year with no events and a gap for an incomplete year', async () => {
    const { user } = setup((request) => okHeatwave(request, { delhi: { incompleteYears: [2024] } }))
    await user.click(compareButton())
    const chart = await screen.findByTestId('compare-chart-heatwave_days')
    await user.click(within(chart).getByText('View data as table'))
    const table = within(chart).getByRole('table', { name: /Heatwave days per year by year and location/ })
    const row2018 = within(table).getByRole('row', { name: /2018/ })
    expect(within(row2018).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0', '0']) // real zeros
    const row2024 = within(table).getByRole('row', { name: /2024/ })
    const cells = within(row2024).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Incomplete year, not plotted') // Delhi: a gap, not a zero
    expect(cells[1]).not.toHaveTextContent('Incomplete')
    expect(screen.getByText(/1 incomplete or without data are left out, not drawn as zero/)).toBeInTheDocument()
    expect(screen.getByText(/Delhi: 6 of 7 years plotted/)).toBeInTheDocument()
  })

  it('shows "No events" for a location without heatwaves, not a missing value', async () => {
    const { user } = setup((request) => okHeatwave(request, { mumbai: { noEvents: true } }))
    await user.click(compareButton())
    const table = await screen.findByRole('table', { name: /Heatwave and temperature metrics/ })
    const events = within(within(table).getByRole('row', { name: /Heatwave events/ })).getAllByRole('cell')
    expect(events.map((c) => c.textContent)).toEqual(['13', '0'])
    const duration = within(within(table).getByRole('row', { name: /Mean event duration/ })).getAllByRole('cell')
    expect(duration[1]).toHaveTextContent('No events')
    const perYear = within(within(table).getByRole('row', { name: /Heatwave days per year/ })).getAllByRole('cell')
    expect(perYear[1]).toHaveTextContent(/^0\.0 \(n = 7\)$/)
  })

  it('analyses at most two locations at a time and starts the next as one finishes', async () => {
    const gates = new Map<number, ReturnType<typeof deferred<HeatwaveAnalysis>>>()
    const { user, fetchers } = setup((request) => {
      const gate = deferred<HeatwaveAnalysis>()
      gates.set(request.latitude, gate)
      return gate.promise
    })
    await user.click(screen.getByRole('checkbox', { name: /Bengaluru/ }))
    await user.click(screen.getByRole('checkbox', { name: /Chennai/ }))
    await user.click(compareButton())

    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(2))
    expect(fetchers.anomaly).toHaveBeenCalledTimes(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchers.heatwave).toHaveBeenCalledTimes(2) // locations 3 and 4 wait for a free slot

    gates.get(28.6139)!.resolve(makeAnalysis())
    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(3))
    gates.get(19.076)!.resolve(makeAnalysis())
    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(4))
  })
})

describe('per-location loading and errors', () => {
  it('shows each location loading on its own while another has finished', async () => {
    const mumbaiGate = deferred<HeatwaveAnalysis>()
    const { user } = setup((request) => (sameCity(request, MUMBAI) ? mumbaiGate.promise : okHeatwave(request)))
    await user.click(compareButton())

    const delhi = await screen.findByTestId('city-status-28.6139,77.2090')
    const mumbai = screen.getByTestId('city-status-19.0760,72.8777')
    await waitFor(() => expect(within(delhi).getByText(/Heatwave statistics: loaded/)).toBeInTheDocument())
    expect(within(mumbai).getByText(/Heatwave statistics: loading/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comparing…' })).toBeDisabled()

    // Until it arrives, Mumbai's cells say loading; they are never zero.
    const table = screen.getByRole('table', { name: /Heatwave and temperature metrics/ })
    const events = within(within(table).getByRole('row', { name: /Heatwave events/ })).getAllByRole('cell')
    expect(events.map((c) => c.textContent)).toEqual(['13', 'Loading…'])

    mumbaiGate.resolve(makeAnalysis())
    await waitFor(() => expect(within(mumbai).getByText(/Heatwave statistics: loaded/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Compare locations' })).toBeEnabled()
    expect(screen.getByText('Comparison complete for 2 locations.')).toBeInTheDocument()
  })

  it('keeps the other locations when one fails, then retries only the failed one', async () => {
    let mumbaiAttempts = 0
    const { user, fetchers } = setup((request) => {
      if (sameCity(request, MUMBAI)) {
        mumbaiAttempts += 1
        if (mumbaiAttempts === 1) return Promise.reject(new ApiError('timeout', 'The analysis took too long', { status: 504 }))
      }
      return okHeatwave(request)
    })
    await user.click(compareButton())

    const mumbai = await screen.findByTestId('city-status-19.0760,72.8777')
    await waitFor(() => expect(within(mumbai).getByText(/Heatwave statistics: failed/)).toBeInTheDocument())
    expect(within(mumbai).getByText(/The analysis took too long/)).toBeInTheDocument()
    expect(within(mumbai).getByText(/Temperature anomalies: loaded/)).toBeInTheDocument() // the other call still worked
    const delhi = screen.getByTestId('city-status-28.6139,77.2090')
    expect(within(delhi).getByText(/Heatwave statistics: loaded/)).toBeInTheDocument()
    expect(within(delhi).queryByRole('button', { name: /Retry/ })).toBeNull()
    expect(screen.getByText('Comparison finished. 1 of 2 locations had errors.')).toBeInTheDocument()

    // The failed value is shown as failed, not as zero, and Delhi's column is intact.
    const table = screen.getByRole('table', { name: /Heatwave and temperature metrics/ })
    const events = within(within(table).getByRole('row', { name: /Heatwave events/ })).getAllByRole('cell')
    expect(events.map((c) => c.textContent)).toEqual(['13', 'Failed to load'])

    const heatwaveCalls = fetchers.heatwave.mock.calls.length
    const anomalyCalls = fetchers.anomaly.mock.calls.length
    await user.click(within(mumbai).getByRole('button', { name: 'Retry Mumbai' }))
    await waitFor(() => expect(within(mumbai).getByText(/Heatwave statistics: loaded/)).toBeInTheDocument())
    expect(fetchers.heatwave.mock.calls.length).toBe(heatwaveCalls + 1) // only the failed request ran again
    expect(fetchers.anomaly.mock.calls.length).toBe(anomalyCalls)
    expect(within(mumbai).queryByRole('button', { name: /Retry/ })).toBeNull()
    expect(within(within(table).getByRole('row', { name: /Heatwave events/ })).getAllByRole('cell').map((c) => c.textContent)).toEqual(['13', '13'])
  })

  it('reports an anomaly failure separately and retries only that request', async () => {
    let attempts = 0
    const { user, fetchers } = setup(okHeatwave, (request) => {
      if (sameCity(request, DELHI)) {
        attempts += 1
        if (attempts === 1) return Promise.reject(new ApiError('validation', 'baseline period has insufficient valid observations', { status: 422 }))
      }
      return okAnomaly(request)
    })
    await user.click(compareButton())
    const delhi = await screen.findByTestId('city-status-28.6139,77.2090')
    await waitFor(() => expect(within(delhi).getByText(/Temperature anomalies: failed/)).toBeInTheDocument())
    expect(within(delhi).getByText(/Heatwave statistics: loaded/)).toBeInTheDocument()
    expect(within(delhi).getByText(/baseline period has insufficient valid observations/)).toBeInTheDocument()

    const table = screen.getByRole('table', { name: /Heatwave and temperature metrics/ })
    expect(within(within(table).getByRole('row', { name: /Heatwave events/ })).getAllByRole('cell')[0]).toHaveTextContent('13')
    expect(within(within(table).getByRole('row', { name: /Mean temperature anomaly/ })).getAllByRole('cell')[0]).toHaveTextContent('Failed to load')

    const heat = fetchers.heatwave.mock.calls.length
    await user.click(within(delhi).getByRole('button', { name: 'Retry Delhi' }))
    await waitFor(() => expect(within(delhi).getByText(/Temperature anomalies: loaded/)).toBeInTheDocument())
    expect(fetchers.heatwave.mock.calls.length).toBe(heat)
  })

  it('tells a rate-limited location when to retry', async () => {
    const { user } = setup((request) =>
      sameCity(request, DELHI)
        ? Promise.reject(new ApiError('rate_limited', 'Rate limit exceeded; retry later', { status: 429, retryAfterSeconds: 12 }))
        : okHeatwave(request),
    )
    await user.click(compareButton())
    const delhi = await screen.findByTestId('city-status-28.6139,77.2090')
    await waitFor(() => expect(within(delhi).getByText(/Too many analyses in a short time\. Try again in about 12s/)).toBeInTheDocument())
  })

  it('offers one button to retry every failed location', async () => {
    const attempts = new Map<number, number>()
    const { user } = setup((request) => {
      const n = (attempts.get(request.latitude) ?? 0) + 1
      attempts.set(request.latitude, n)
      return n === 1 ? Promise.reject(new ApiError('network', 'Network request failed.')) : okHeatwave(request)
    })
    await user.click(compareButton())
    const retryAll = await screen.findByRole('button', { name: 'Retry all failed (2)' })
    await user.click(retryAll)
    await waitFor(() => expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(2))
    expect(screen.queryByRole('button', { name: /Retry all failed/ })).toBeNull()
  })

  it('cancel aborts in-flight requests and returns to the empty state', async () => {
    const signals: AbortSignal[] = []
    const fetchers = {
      heatwave: vi.fn((_r: HeatwaveRequest, options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        return new Promise<HeatwaveAnalysis>(() => {})
      }),
      anomaly: vi.fn((_r: AnomalyRequest, options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        return new Promise<TemperatureAnomalies>(() => {})
      }),
    }
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <ComparisonView fetchers={fetchers as unknown as ComparisonFetchers} now={NOW} />
      </TooltipProvider>,
    )
    await user.click(compareButton())
    await waitFor(() => expect(signals).toHaveLength(4))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signals.every((s) => s.aborted)).toBe(true)
    expect(screen.getByRole('heading', { name: 'Choose two to four locations to compare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compare locations' })).toBeEnabled()
  })
})

describe('coverage explanations and accessibility', () => {
  it('explains data coverage differences and flags incomplete years per location', async () => {
    const { user } = setup((request) => okHeatwave(request, { mumbai: { incompleteYears: [2023], missingDates: ['2021-03-04'] } }))
    await user.click(compareButton())
    expect(await screen.findByRole('heading', { name: 'Data coverage' })).toBeInTheDocument()
    expect(screen.getByText(/Mumbai: 6 of 7 years are complete/)).toBeInTheDocument()
    expect(screen.getByText(/a location with missing days can show fewer events without being less hot/i)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /Heatwave and temperature metrics/ })
    const complete = within(within(table).getByRole('row', { name: /Complete years/ })).getAllByRole('cell')
    expect(complete.map((c) => c.textContent)).toEqual(['7 of 7', '6 of 7'])
  })

  it('makes the table keyboard-scrollable on narrow screens without widening the page', async () => {
    const { user } = setup()
    await user.click(compareButton())
    const region = await screen.findByRole('region', { name: /Comparison table, scrolls sideways/ })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region.className).toContain('overflow-x-auto')
    expect(region.className).toContain('max-w-full')
  })

  it('labels every control and gives each chart a title, legend and caption', async () => {
    const { user } = setup()
    await user.click(compareButton())
    await screen.findByTestId('compare-chart-anomaly')
    for (const figure of screen.getAllByRole('figure')) {
      expect(figure).toHaveAccessibleName()
      expect(figure).toHaveAccessibleDescription()
      expect(within(figure).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2)
    }
    for (const input of screen.getAllByRole('textbox')) expect(input).toHaveAccessibleName()
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAccessibleName()
  })
})
