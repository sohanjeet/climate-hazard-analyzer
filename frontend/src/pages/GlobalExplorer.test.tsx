import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import GlobalExplorer from '@/pages/GlobalExplorer'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'
import { fakeGeography } from '@/test/geoFixtures'

const NOW = new Date(2026, 9, 14)

beforeAll(async () => {
  await Promise.all([import('@/pages/TrendCharts'), import('@/lib/geo/boundaries').then((m) => m.loadWorld())])
})

function setup() {
  const fetchers = { heatwave: vi.fn(async () => makeAnalysis()), anomaly: vi.fn(async () => makeAnomalies()) }
  const geography = fakeGeography({ status: { 'fra-paris': 'stored' } })
  const user = userEvent.setup()
  const view = render(
    <TooltipProvider>
      <GlobalExplorer fetchers={fetchers as unknown as ComparisonFetchers} geography={geography} now={NOW} />
    </TooltipProvider>,
  )
  return { user, fetchers, geography, container: view.container }
}

const country = (container: HTMLElement, id: string) => container.querySelector(`path[data-id="${id}"]`)!

describe('Global Climate Explorer', () => {
  it('renders the world map with countries and requests no analysis on load', async () => {
    const { fetchers, geography } = setup()
    const map = await screen.findByRole('listbox', { name: 'World map of countries' })
    expect(within(map).getAllByRole('option')).toHaveLength(248)
    await waitFor(() => expect(geography.coverage).toHaveBeenCalledTimes(1))
    expect(geography.coverage).toHaveBeenCalledWith({ startDate: '2010-01-01', endDate: '2025-12-31', country: undefined }, expect.anything())
    expect(fetchers.heatwave).not.toHaveBeenCalled()
  })

  it('selects a country on click and shows its ISO codes and locations, labelled as locations', async () => {
    const { container } = setup()
    await screen.findByRole('listbox', { name: 'World map of countries' })
    await waitFor(() => expect(country(container, 'FRA')).toHaveAttribute('fill', 'var(--map-stored)'))
    fireEvent.click(country(container, 'FRA'))
    const panel = screen.getByRole('complementary', { name: 'Country details' })
    expect(within(panel).getByRole('heading', { level: 2, name: 'France' })).toBeInTheDocument()
    expect(within(panel).getByText('FR / FRA')).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Paris' })).toBeInTheDocument()
    expect(within(panel).getByText('Observation location in France, not a national average')).toBeInTheDocument()
  })

  it('shows an honest unavailable state for a country without locations', async () => {
    const { container } = setup()
    await screen.findByRole('listbox', { name: 'World map of countries' })
    expect(country(container, 'ISL')).toHaveAttribute('fill', 'var(--map-none)')
    fireEvent.click(country(container, 'ISL'))
    const empty = screen.getByTestId('no-data-country')
    expect(empty).toHaveTextContent('No supported observation location in Iceland yet')
    expect(empty).toHaveTextContent('Country-wide statistics are not shown anywhere in this app')
    expect(screen.queryByText(/[0-9.]+ days\/yr/)).toBeNull()
  })

  it('finds a country by ISO code and analyses all its locations on request', async () => {
    const { user, fetchers } = setup()
    await screen.findByRole('listbox', { name: 'World map of countries' })
    await user.type(screen.getByRole('combobox', { name: 'Find a country' }), 'USA')
    const list = await screen.findByRole('listbox', { name: 'Find a country results' })
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { level: 2, name: 'United States' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Analyse all 2 locations' }))
    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(2))
    expect(await screen.findAllByText('Heatwave days per year', { selector: 'dt' })).toHaveLength(2)
    expect(await screen.findByTestId('compare-chart-heatwave_days')).toBeInTheDocument() // trend chart for the analysed pair
  })

  it('lists many locations compactly, without a bulk "analyse all", and points to the India Explorer', async () => {
    const { container, fetchers } = setup()
    await screen.findByRole('listbox', { name: 'World map of countries' })
    fireEvent.click(country(container, 'IND'))
    const list = screen.getByRole('list', { name: 'Observation locations in India' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /Analyse all/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'India Explorer' })).toHaveAttribute('href', '/explore/india')
    fireEvent.click(within(list).getByRole('button', { name: 'Analyse Jaipur' }))
    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(1))
  })

  it('lists every observation location with its availability', async () => {
    setup()
    const table = await screen.findByRole('table', { name: /Observation locations with data availability/ })
    await waitFor(() => expect(within(table).getByRole('rowheader', { name: 'Paris' }).parentElement).toHaveTextContent('Stored'))
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 9)
  })
})
