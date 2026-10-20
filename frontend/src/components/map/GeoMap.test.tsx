import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import indiaText from '@/data/geo/india-states.topo.json?raw'
import worldText from '@/data/geo/world-countries.topo.json?raw'
import { GeoMap, type MapMarker } from '@/components/map/GeoMap'
import { parseIndia, parseWorld, type MapFeature } from '@/lib/geo/boundaries'

const INDIA = parseIndia(indiaText)
const WORLD = parseWorld(worldText)

const MARKERS: MapMarker[] = [
  { id: 'in-rj-jaipur', longitude: 75.7873, latitude: 26.9124, label: 'Jaipur: 7.5 days/yr', fill: 'var(--seq-3)' },
  { id: 'in-dl-delhi', longitude: 77.209, latitude: 28.6139, label: 'Delhi: not analysed yet', fill: null },
]

function Harness({ features = INDIA, kind = 'india' as const, onSelect = vi.fn() }: { features?: readonly MapFeature[]; kind?: 'india' | 'world'; onSelect?: (id: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <GeoMap
      kind={kind}
      features={features}
      label="Test map"
      fillFor={(f) => (f.id === 'IN-RJ' ? 'var(--map-stored)' : 'var(--map-available)')}
      describe={(f) => `${f.name} description`}
      tooltip={(f) => <span>{f.name} tooltip</span>}
      selectedId={selected}
      onSelect={(id) => {
        setSelected(id)
        onSelect(id)
      }}
      markers={MARKERS}
    />
  )
}

const option = (name: string) => screen.getByRole('option', { name: `${name} description` })

describe('GeoMap', () => {
  it('renders every Indian state and union territory as a selectable option', () => {
    render(<Harness />)
    const listbox = screen.getByRole('listbox', { name: 'Test map' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(36)
    expect(option('Rajasthan')).toHaveAttribute('fill', 'var(--map-stored)')
    for (const path of within(listbox).getAllByRole('option')) expect(path.getAttribute('d')).toMatch(/^M/)
  })

  it('renders the world map', () => {
    render(<Harness features={WORLD} kind="world" />)
    expect(screen.getAllByRole('option')).toHaveLength(248)
    expect(screen.getByRole('option', { name: 'India description' })).toBeInTheDocument()
  })

  it('shows a tooltip on hover and selects on click', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    fireEvent.pointerMove(option('Kerala'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Kerala tooltip')
    fireEvent.pointerLeave(option('Kerala').parentElement!)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(option('Kerala'))
    expect(onSelect).toHaveBeenLastCalledWith('IN-KL')
    expect(option('Kerala')).toHaveAttribute('aria-selected', 'true')
  })

  it('is operable from the keyboard with a single tab stop', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const stops = screen.getAllByRole('option').filter((o) => o.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    await user.tab()
    expect(document.activeElement).toBe(option('Andaman and Nicobar Islands'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Andaman and Nicobar Islands tooltip') // focus shows it too
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(option('Andhra Pradesh'))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(option('West Bengal'))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(option('Andaman and Nicobar Islands')) // wraps
    await user.keyboard('k')
    expect(document.activeElement).toBe(option('Karnataka'))
    await user.keyboard('k')
    expect(document.activeElement).toBe(option('Kerala')) // the same letter again moves to the next match
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith('IN-KL')
    await user.keyboard('{Escape}')
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('draws analysed locations as filled markers and the rest hollow', () => {
    render(<Harness />)
    const markers = screen.getAllByTestId('map-marker')
    expect(markers.map((m) => m.getAttribute('data-filled'))).toEqual(['true', 'false'])
    fireEvent.pointerMove(markers[0])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Jaipur: 7.5 days/yr')
  })

  it('has zoom and reset controls', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const group = screen.getByRole('listbox').parentElement!
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(group.getAttribute('transform')).toMatch(/scale\(1\.6\)/)
    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await user.click(screen.getByRole('button', { name: 'Reset map view' }))
    expect(group.getAttribute('transform')).toBe('translate(0,0) scale(1)')
  })
})
