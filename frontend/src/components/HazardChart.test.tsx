import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChartsSection } from '@/components/ChartsSection'
import { HazardChart } from '@/components/HazardChart'
import { CHART_METRICS, buildChartSeries } from '@/lib/chartData'
import { makeAnalysis, type FixtureOptions } from '@/test/fixtures'

const frequency = CHART_METRICS[0]
const meanDuration = CHART_METRICS[2]

function renderChart(options: FixtureOptions, metric = frequency) {
  const series = buildChartSeries(makeAnalysis(options), metric)
  return render(
    <TooltipProvider>
      <HazardChart metric={metric} series={series} />
    </TooltipProvider>,
  )
}

// Reduced motion renders bars in their final state at once; with animation on, jsdom would show them mid-grow.
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

describe('HazardChart', () => {
  it('draws one bar per year with a positive value and a rolling line', () => {
    const { container } = renderChart({})
    // 7 complete years; 2018 has zero events, which is a zero-height bar and so draws nothing visible.
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(6)
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull()
  })

  it('draws incomplete years in a separate hatched series and explains it', () => {
    const { container } = renderChart({ incompleteYears: [2023, 2024] })
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(6)
    const solid = container.querySelectorAll('.recharts-bar-rectangle [fill="var(--heat)"]')
    const hatched = container.querySelectorAll('.recharts-bar-rectangle [fill^="url(#hatch-"]')
    expect(solid.length).toBe(4) // 2019-2022; 2018 is zero
    expect(hatched.length).toBe(2) // 2023, 2024
    expect(screen.getByText(/2 incomplete \(hatched, not used in trends\)/)).toBeInTheDocument()
  })

  it('leaves no bar for years without events and says the value is undefined, not zero', () => {
    const { container } = renderChart({}, meanDuration)
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(6) // 2018 has no events
    expect(screen.getByText(/1 without events \(no bar: mean event duration is undefined, not zero\)/)).toBeInTheDocument()
  })

  it('leaves no bar for a year with no observations and flags it', () => {
    const { container } = renderChart({ unobservedYears: [2020] })
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(5)
    expect(screen.getByText(/1 without any observations \(no bar\)/)).toBeInTheDocument()
  })

  it('omits the rolling line and says why when none is available', () => {
    const { container } = renderChart({ trend: 'none' })
    expect(container.querySelector('.recharts-line-curve')).toBeNull()
    expect(screen.getByText(/rolling average is unavailable/i)).toBeInTheDocument()
  })

  it('offers every year as an accessible data table with a status per year', async () => {
    renderChart({ incompleteYears: [2024], unobservedYears: [2020] })
    await userEvent.click(screen.getByText('View data as table'))
    const table = screen.getByRole('table', { name: /heatwave frequency by year/i })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(1 + 7)
    const text = (year: number) => rows.find((r) => within(r).queryByRole('rowheader', { name: String(year) }))!.textContent
    expect(text(2024)).toContain('Incomplete year (not used in trends)')
    expect(text(2020)).toContain('No valid observations')
    expect(text(2020)).toContain('0/366')
    expect(text(2023)).toContain('Complete year')
  })

  it('labels the figure with its title and caption for assistive technology', () => {
    renderChart({})
    const figure = screen.getByRole('figure', { name: /heatwave frequency/i })
    expect(figure).toHaveAccessibleDescription(/7 years shown/)
  })
})

describe('ChartsSection', () => {
  it('renders the four charts and only the legend entries that apply', () => {
    render(
      <TooltipProvider>
        <ChartsSection data={makeAnalysis({ incompleteYears: [2024] })} />
      </TooltipProvider>,
    )
    for (const title of ['Heatwave frequency', 'Heatwave days', 'Mean event duration', 'Maximum intensity']) {
      expect(screen.getByRole('figure', { name: new RegExp(title, 'i') })).toBeInTheDocument()
    }
    const legend = screen.getByRole('list', { name: 'Chart legend' })
    expect(legend).toHaveTextContent('Complete year')
    expect(legend).toHaveTextContent('Incomplete year, shown but not used in trends')
    expect(legend).toHaveTextContent('3-year rolling mean (trailing)')
    expect(screen.getByText(/counted in the calendar year it starts/i)).toBeInTheDocument()
  })

  it('hides the incomplete-year legend entry when every year is complete', () => {
    render(
      <TooltipProvider>
        <ChartsSection data={makeAnalysis()} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('list', { name: 'Chart legend' })).not.toHaveTextContent('Incomplete year')
  })
})
