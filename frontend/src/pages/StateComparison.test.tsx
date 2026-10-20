import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import { ApiError } from '@/lib/api/errors'
import type { HeatwaveRequest } from '@/lib/api/types'
import StateComparison from '@/pages/StateComparison'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'
import { fakeGeography } from '@/test/geoFixtures'

const NOW = new Date(2026, 9, 14)

beforeAll(async () => {
  await Promise.all([import('@/pages/TrendCharts'), import('@/components/compare/GroupedBarChart'), import('@/components/explore/IndicatorBarChart')])
})

afterEach(() => {
  vi.restoreAllMocks()
})

function setup({ failFor }: { failFor?: number } = {}) {
  let failures = 0
  const fetchers = {
    heatwave: vi.fn(async (r: HeatwaveRequest) => {
      if (r.latitude === failFor && failures === 0) {
        failures += 1
        throw new ApiError('upstream', 'Open-Meteo failed', { status: 502 })
      }
      return makeAnalysis({ latitude: r.latitude, longitude: r.longitude })
    }),
    anomaly: vi.fn(async () => makeAnomalies()),
  }
  const geography = fakeGeography({ status: { 'in-rj-jaipur': 'stored' } })
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <StateComparison fetchers={fetchers as unknown as ComparisonFetchers} geography={geography} now={NOW} />
    </TooltipProvider>,
  )
  return { user, fetchers }
}

const search = () => screen.getByRole('combobox', { name: /Add a state/ })

async function add(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.clear(search())
  await user.type(search(), name)
  const list = await screen.findByRole('listbox', { name: /Add a state.*results/ })
  await user.click(within(list).getByRole('option', { name: new RegExp(`^${name}`) }))
}

describe('State comparison', () => {
  it('needs at least two states and allows at most four', async () => {
    const { user, fetchers } = setup()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare states' })).toBeEnabled())
    await add(user, 'Rajasthan')
    await user.click(screen.getByRole('button', { name: 'Compare states' }))
    expect(screen.getByText('Select at least 2 states to compare.')).toBeInTheDocument()
    expect(fetchers.heatwave).not.toHaveBeenCalled()
    for (const name of ['Delhi', 'Kerala', 'Punjab']) await add(user, name)
    expect(screen.getByRole('combobox', { name: 'Add a state (4 of 4)' })).toBeInTheDocument()
    await user.type(search(), 'Ladakh')
    const option = within(await screen.findByRole('listbox', { name: /results/ })).getByRole('option')
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).toHaveTextContent('Limit reached')
  })

  it('compares the selected states as observation locations, with per-state errors and retry', async () => {
    const { user, fetchers } = setup({ failFor: 28.6139 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare states' })).toBeEnabled())
    await add(user, 'Rajasthan')
    await add(user, 'Delhi')
    await user.click(screen.getByRole('button', { name: 'Compare states' }))
    await waitFor(() => expect(fetchers.heatwave).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Scope: observation locations')).toBeInTheDocument()
    expect(screen.getByText(/Rajasthan: capital-city observation point, not a state-wide average/)).toBeInTheDocument()
    const retry = await screen.findByRole('button', { name: 'Retry Delhi · Delhi' })
    expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(1) // Rajasthan is unaffected
    await user.click(retry)
    await waitFor(() => expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(2))
    expect(screen.getByTestId('grouped-bar-chart')).toBeInTheDocument()
    expect(screen.getByTestId('compare-chart-heatwave_days')).toBeInTheDocument()
    expect(screen.getByTestId('compare-chart-anomaly')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Annual trends' })).toBeInTheDocument()
  })

  it('downloads a CSV that states its scope', async () => {
    const created: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return 'blob:test'
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { user } = setup()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare states' })).toBeEnabled())
    await add(user, 'Rajasthan')
    await add(user, 'Kerala')
    await user.click(screen.getByRole('button', { name: 'Compare states' }))
    await waitFor(() => expect(screen.getAllByText(/Heatwave statistics: loaded/)).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(click).toHaveBeenCalledTimes(1)
    const text = await created[0].text()
    expect(text.split('\r\n')[0]).toMatch(/^﻿?scope,area_code,area_name,location_name/)
    expect(text).toContain('observation_location (not an area aggregate),IN-RJ,Rajasthan,Rajasthan · Jaipur,26.9124,75.7873,2018')
    expect(text).toContain('IN-KL,Kerala,Kerala · Thiruvananthapuram')
  })

  it('clears the selection', async () => {
    const { user } = setup()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare states' })).toBeEnabled())
    await add(user, 'Rajasthan')
    expect(screen.getByRole('button', { name: 'Remove Rajasthan' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByText('No state selected yet. Use the search above.')).toBeInTheDocument()
  })
})
