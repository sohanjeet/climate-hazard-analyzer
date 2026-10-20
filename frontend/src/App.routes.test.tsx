import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ComparisonFetchers } from '@/hooks/useComparison'
import { makeAnalysis, makeAnomalies } from '@/test/fixtures'
import { fakeGeography } from '@/test/geoFixtures'

const NOW = new Date(2026, 9, 14)

beforeAll(async () => {
  await Promise.all([
    import('@/pages/GlobalExplorer'),
    import('@/pages/IndiaExplorer'),
    import('@/pages/StateComparison'),
    import('@/pages/AnomaliesPage'),
    import('@/pages/MethodologyPage'),
    import('@/pages/NotFoundPage'),
    import('@/lib/geo/boundaries').then((m) => Promise.all([m.loadIndia(), m.loadWorld()])),
  ])
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  const geography = fakeGeography()
  const geoFetchers = { heatwave: vi.fn(async () => makeAnalysis()), anomaly: vi.fn(async () => makeAnomalies()) }
  const user = userEvent.setup()
  const view = render(
    <App
      fetcher={vi.fn(async () => makeAnalysis())}
      anomalyFetcher={vi.fn(async () => makeAnomalies())}
      geoFetchers={geoFetchers as unknown as ComparisonFetchers}
      geography={geography}
      now={NOW}
    />,
  )
  return { user, geography, geoFetchers, container: view.container }
}

const mainNav = () => screen.getByRole('navigation', { name: 'Main' })

describe('routes', () => {
  it.each([
    ['/explore/global', 'Global Climate Explorer', 'Global Explorer'],
    ['/explore/india', 'India Climate Explorer', 'India Explorer'],
    ['/compare/states', 'Compare states', 'State Comparison'],
    ['/anomalies', 'Temperature anomalies', 'Temperature Anomalies'],
    ['/methodology', 'Methodology', 'Methodology'],
  ])('opens %s directly', async (path, heading, link) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { level: 1, name: 'Heatwave Trend Analyzer' })).toBeNull()
    await waitFor(() => expect(document.title).toMatch(/· Climate Hazard Trend Analyzer$/))
  })

  it('rewrites an alias to the canonical path', async () => {
    renderAt('/compare')
    expect(await screen.findByRole('heading', { level: 1, name: 'Compare locations' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/compare/cities'))
  })

  it('shows a not-found page with links to every page', async () => {
    renderAt('/does-not-exist')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getAllByRole('link')).toHaveLength(7)
  })

  it('keeps an explorer selection when leaving and coming back', async () => {
    const { user } = renderAt('/explore/india')
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    // fireEvent: user-event's synthetic mousedown has no `view`, which d3-zoom's drag start needs (browsers always set it).
    fireEvent.click(screen.getByRole('option', { name: /^Rajasthan/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Rajasthan' })).toBeInTheDocument()
    await user.click(within(mainNav()).getByRole('link', { name: 'Dashboard' }))
    expect(screen.queryByRole('heading', { level: 2, name: 'Rajasthan' })).toBeNull()
    await user.click(within(mainNav()).getByRole('link', { name: 'India Explorer' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Rajasthan' })).toBeInTheDocument()
  })

  it('loads the catalog once per session across pages', async () => {
    const { user, geography } = renderAt('/explore/india')
    await screen.findByRole('listbox', { name: 'Map of Indian states and union territories' })
    await user.click(within(mainNav()).getByRole('link', { name: 'State Comparison' }))
    await screen.findByRole('heading', { level: 1, name: 'Compare states' })
    // Each page asks the shared API object; the default implementation memoises the request for the session.
    expect(geography.locations).toHaveBeenCalledTimes(2)
    expect(geography.coverage).toHaveBeenCalledTimes(1) // the comparison asks for coverage only after a run
  })
})

describe('header', () => {
  it('has a menu disclosure for narrow screens', async () => {
    const { user } = renderAt('/')
    const button = screen.getByRole('button', { name: 'Menu' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('navigation', { name: 'Main menu' })
    await user.keyboard('{Escape}')
    expect(menu).not.toBeVisible()
    expect(button).toHaveFocus()
    await user.click(button)
    await user.click(within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('link', { name: 'Methodology' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Methodology' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull() // closed after navigating
  })

  it('switches and remembers the colour theme', async () => {
    const { user } = renderAt('/')
    await user.click(screen.getByRole('button', { name: /Colour theme: System. Switch to Light/ }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('chta-theme')).toBe('light')
    await user.click(screen.getByRole('button', { name: /Colour theme: Light. Switch to Dark/ }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await user.click(screen.getByRole('button', { name: /Colour theme: Dark. Switch to System/ }))
    expect(window.localStorage.getItem('chta-theme')).toBeNull()
  })
})

describe('accessibility', () => {
  // jsdom has no layout, so colour contrast is checked in the real-browser run (scripts/browser-check.mjs).
  const options: axe.RunOptions = { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] }

  it.each(['/explore/india', '/explore/global', '/compare/states'])('%s has no axe violations', async (path) => {
    renderAt(path)
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(screen.queryByText('Loading observation locations…')).toBeNull())
    const result = await axe.run(document.body, options)
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])
  })
})
