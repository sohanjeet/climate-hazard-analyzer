import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import { ApiError } from '@/lib/api/errors'
import type { AnomalyRequest, HeatwaveRequest } from '@/lib/api/types'
import IndiaExplorer from '@/pages/IndiaExplorer'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'
import { fakeGeography } from '@/test/geoFixtures'

const NOW = new Date(2026, 9, 14)

beforeAll(async () => {
  await Promise.all([import('@/pages/TrendCharts'), import('@/components/explore/IndicatorBarChart'), import('@/lib/geo/boundaries').then((m) => m.loadIndia())])
})

function setup({ geography = fakeGeography({ status: { 'in-rj-jaipur': 'stored' } }), heatwave }: { geography?: ReturnType<typeof fakeGeography>; heatwave?: (r: HeatwaveRequest) => Promise<unknown> } = {}) {
  const fetchers = {
    heatwave: vi.fn(heatwave ?? (async (r: HeatwaveRequest) => makeAnalysis({ latitude: r.latitude, longitude: r.longitude }))),
    anomaly: vi.fn(async (r: AnomalyRequest) => makeAnomalies({ latitude: r.latitude, longitude: r.longitude })),
  }
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <IndiaExplorer fetchers={fetchers as unknown as ComparisonFetchers} geography={geography} now={NOW} />
    </TooltipProvider>,
  )
  return { user, fetchers, geography }
}

async function pickState(user: ReturnType<typeof userEvent.setup>, query: string, name: string) {
  await user.type(screen.getByRole('combobox', { name: 'Find a state or union territory' }), query)
  const list = await screen.findByRole('listbox', { name: 'Find a state or union territory results' })
  await user.click(within(list).getByText(name))
}

describe('India Climate Explorer', () => {
  it('renders all 36 states and UTs and requests nothing heavy on load', async () => {
    const { fetchers, geography } = setup()
    const map = await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    expect(within(map).getAllByRole('option')).toHaveLength(36)
    expect(screen.getByRole('heading', { level: 1, name: 'India Climate Explorer' })).toBeInTheDocument()
    await waitFor(() => expect(geography.coverage).toHaveBeenCalledTimes(1))
    expect(geography.coverage).toHaveBeenCalledWith({ startDate: '2010-01-01', endDate: '2025-12-31', country: 'IND' }, expect.anything())
    expect(geography.locations).toHaveBeenCalledTimes(1)
    expect(fetchers.heatwave).not.toHaveBeenCalled() // no analysis, so no ingestion, until asked
    expect(fetchers.anomaly).not.toHaveBeenCalled()
    expect(screen.getByText(/Location-level observations\./)).toBeInTheDocument()
  })

  it('colours areas by data availability only', async () => {
    setup()
    const rajasthan = await screen.findByRole('option', { name: /^Rajasthan, state; observation location Jaipur/ })
    await waitFor(() => expect(rajasthan).toHaveAttribute('fill', 'var(--map-stored)'))
    expect(screen.getByRole('option', { name: /^Delhi, union territory/ })).toHaveAttribute('fill', 'var(--map-available)')
    expect(screen.getByRole('option', { name: /^Bihar, state$/ })).toHaveAttribute('fill', 'var(--map-none)') // no fixture location
  })

  it('selects a state from the search and labels its location as a capital-city point', async () => {
    const { user } = setup()
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    await pickState(user, 'rajas', 'Rajasthan')
    const panel = screen.getByRole('complementary', { name: 'State details' })
    expect(within(panel).getByRole('heading', { level: 2, name: 'Rajasthan' })).toBeInTheDocument()
    expect(within(panel).getByText('State · IN-RJ')).toBeInTheDocument()
    expect(within(panel).getByText('Capital-city observation point, not a state-wide average')).toBeInTheDocument()
    expect(await within(panel).findByText('Data stored')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Rajasthan/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('analyses on demand, then colours the marker and fills the summary', async () => {
    const { user, fetchers } = setup()
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    await pickState(user, 'IN-RJ', 'Rajasthan')
    await user.click(screen.getByRole('button', { name: 'Analyse Jaipur' }))
    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(1))
    expect(fetchers.heatwave.mock.calls[0][0]).toEqual({ latitude: 26.9124, longitude: 75.7873, startDate: '2010-01-01', endDate: '2025-12-31' })
    const card = await screen.findByTestId('location-card')
    expect(await within(card).findByText('Heatwave days per year')).toBeInTheDocument()
    expect(within(card).getByText('Temperature trend').nextSibling).toHaveTextContent('Not available')
    expect(screen.getAllByTestId('map-marker').filter((m) => m.getAttribute('data-filled') === 'true')).toHaveLength(1)
    expect(screen.getByText(/Jaipur \(Rajasthan\); one location, among those analysed\./)).toBeInTheDocument()
    expect(screen.getByTestId('indicator-bar-chart')).toBeInTheDocument()
  })

  it('switches the indicator and offers the temperature trend only as unavailable', async () => {
    const { user } = setup()
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    const select = screen.getByRole('combobox', { name: 'Climate indicator' })
    expect(within(select).getByRole('option', { name: /Temperature trend.*not available/ })).toBeDisabled()
    await user.selectOptions(select, 'anomaly')
    expect(screen.getByRole('heading', { name: /Markers: Temperature anomaly/ })).toBeInTheDocument()
  })

  it('shows a failed analysis with its own retry', async () => {
    let calls = 0
    const { user, fetchers } = setup({
      heatwave: async () => {
        calls += 1
        if (calls === 1) throw new ApiError('upstream', 'Open-Meteo failed', { status: 502 })
        return makeAnalysis()
      },
    })
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    await pickState(user, 'Rajasthan', 'Rajasthan')
    await user.click(screen.getByRole('button', { name: 'Analyse Jaipur' }))
    expect(await screen.findByText(/The weather archive returned an error/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry Jaipur' }))
    expect(await screen.findByText('Heatwave days per year', { selector: 'dt' })).toBeInTheDocument()
    expect(fetchers.heatwave).toHaveBeenCalledTimes(2)
  })

  it('keeps the map usable when the catalog or coverage cannot be loaded', async () => {
    setup({ geography: fakeGeography({ failLocations: true }) })
    expect(await screen.findByText('Observation locations could not be loaded')).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: /, (state|union territory)/ })).toHaveLength(36)
  })

  it('says when stored-data coverage is unavailable', async () => {
    setup({ geography: fakeGeography({ failCoverage: true }) })
    expect(await screen.findByText(/Stored-data coverage is unavailable right now/)).toBeInTheDocument()
  })

  it('validates the year range before anything runs', async () => {
    const { user } = setup()
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'From year' }), '2020')
    await user.selectOptions(screen.getByRole('combobox', { name: 'To year' }), '2015')
    expect(screen.getByRole('alert')).toHaveTextContent('The start year must be on or before the end year.')
  })

  it('lists data availability for every state and UT', async () => {
    setup()
    const table = await screen.findByRole('table', { name: /every state and union territory/ })
    expect(within(table).getAllByRole('row')).toHaveLength(37)
    expect(within(table).getByRole('rowheader', { name: /Punjab/ }).parentElement).toHaveTextContent('Ludhiana (major city)')
  })
})
