import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { geoConicEqualArea, geoEqualEarth, geoPath, type GeoProjection } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import type { MapFeature } from '@/lib/geo/boundaries'

/**
 * Interactive SVG map for the explorer pages (d3-geo projection, d3-zoom pan/zoom, React rendering).
 *
 * - Polygons carry data COVERAGE only; climate values are drawn as point markers (docs/geospatial_architecture.md §5).
 * - Pointer: hover highlights and shows a tooltip; click selects. Drag pans. Ctrl/Cmd + wheel, a two-finger
 *   pinch, or the buttons zoom, so ordinary page scrolling (and one-finger touch scrolling) is never captured.
 * - Keyboard: the map is a single-select listbox with one tab stop. Arrow keys move, Home/End jump, typing a
 *   letter jumps by name, Enter or Space selects, Escape clears the selection.
 */

export type MapKind = 'world' | 'india'

const SIZE: Record<MapKind, { width: number; height: number; maxZoom: number }> = {
  world: { width: 960, height: 470, maxZoom: 12 },
  india: { width: 800, height: 860, maxZoom: 10 },
}

export interface MapMarker {
  id: string
  longitude: number
  latitude: number
  label: string
  /** Fill for an analysed value; null draws a hollow "not analysed" marker. */
  fill: string | null
  emphasised?: boolean
}

interface GeoMapProps<F extends MapFeature> {
  kind: MapKind
  features: readonly F[]
  /** Accessible name of the map, e.g. "World map of countries". */
  label: string
  fillFor: (feature: F) => string
  /** Spoken description of one feature (name plus coverage). */
  describe: (feature: F) => string
  tooltip: (feature: F) => React.ReactNode
  selectedId: string | null
  onSelect: (id: string | null) => void
  markers?: readonly MapMarker[]
  onMarkerSelect?: (id: string) => void
  /** Changing `nonce` zooms to the feature `id` (used after a search). */
  focusRequest?: { id: string; nonce: number } | null
}

/** Keeps the centred tooltip (at most 16rem wide) inside the map, so it never widens the page on a phone. */
const clampLeft = (position: string) => `clamp(8rem, ${position}, calc(100% - 8rem))`

function makeProjection(kind: MapKind, features: readonly MapFeature[]): GeoProjection {
  const { width, height } = SIZE[kind]
  if (kind === 'world') return geoEqualEarth().fitExtent([[4, 4], [width - 4, height - 4]], { type: 'Sphere' })
  // Conic equal-area, standard parallels 12°N and 28°N, central meridian 80°E: state areas are comparable.
  return geoConicEqualArea()
    .parallels([12, 28])
    .rotate([-80, 0])
    .fitExtent([[12, 12], [width - 12, height - 12]], {
      type: 'FeatureCollection',
      features: features.map((f) => ({ type: 'Feature' as const, geometry: f.geometry, properties: {} })),
    })
}

interface Shape {
  id: string
  name: string
  d: string
  centroid: [number, number]
  bounds: [[number, number], [number, number]]
}

const FeatureLayer = memo(function FeatureLayer({
  shapes,
  fills,
  descriptions,
  selectedId,
  tabStopId,
}: {
  shapes: readonly Shape[]
  fills: ReadonlyMap<string, string>
  descriptions: ReadonlyMap<string, string>
  selectedId: string | null
  tabStopId: string | null
}) {
  return (
    <>
      {shapes.map((shape) => (
        <path
          key={shape.id}
          data-id={shape.id}
          d={shape.d}
          role="option"
          aria-selected={shape.id === selectedId}
          aria-label={descriptions.get(shape.id) ?? shape.name}
          tabIndex={shape.id === tabStopId ? 0 : -1}
          fill={fills.get(shape.id) ?? 'var(--map-none)'}
          stroke="var(--map-border)"
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
          className="cursor-pointer outline-none"
        />
      ))}
    </>
  )
})

export function GeoMap<F extends MapFeature>({
  kind,
  features,
  label,
  fillFor,
  describe,
  tooltip,
  selectedId,
  onSelect,
  markers = [],
  onMarkerSelect,
  focusRequest,
}: GeoMapProps<F>) {
  const uid = useId()
  const { width, height, maxZoom } = SIZE[kind]
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [hover, setHover] = useState<{ id: string; x: number; y: number; marker?: boolean } | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const typeahead = useRef({ text: '', at: 0 })

  const projection = useMemo(() => makeProjection(kind, features), [kind, features])
  const shapes = useMemo<Shape[]>(() => {
    const path = geoPath(projection)
    return features.map((f) => ({
      id: f.id,
      name: f.name,
      d: path(f.geometry) ?? '',
      centroid: path.centroid(f.geometry) as [number, number],
      bounds: path.bounds(f.geometry) as [[number, number], [number, number]],
    }))
  }, [features, projection])
  const sphere = useMemo(() => (kind === 'world' ? geoPath(projection)({ type: 'Sphere' }) ?? '' : ''), [kind, projection])
  const byId = useMemo(() => new Map(features.map((f) => [f.id, f])), [features])
  const shapeById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes])
  const fills = useMemo(() => new Map(features.map((f) => [f.id, fillFor(f)])), [features, fillFor])
  const descriptions = useMemo(() => new Map(features.map((f) => [f.id, describe(f)])), [features, describe])
  const order = useMemo(() => shapes.map((s) => s.id), [shapes]) // features arrive sorted by name

  const tabStopId = focusedId ?? selectedId ?? order[0] ?? null

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, maxZoom])
      .extent([[0, 0], [width, height]])
      .translateExtent([[0, 0], [width, height]])
      .clickDistance(4)
      .filter((event: Event) => {
        if (event.type === 'wheel') return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey
        if (event.type.startsWith('touch')) return (event as TouchEvent).touches.length > 1
        return !(event as MouseEvent).button
      })
      .on('zoom', (event: { transform: ZoomTransform }) => setTransform(event.transform))
    const selection = select(svg)
    selection.call(behavior).on('dblclick.zoom', null)
    // One finger scrolls the page; two fingers pan and pinch the map.
    svg.style.touchAction = 'pan-x pan-y'
    zoomRef.current = behavior
    return () => {
      selection.on('.zoom', null)
      zoomRef.current = null
    }
  }, [width, height, maxZoom])

  const applyZoom = useCallback((next: ZoomTransform) => {
    const svg = svgRef.current
    if (svg && zoomRef.current) select(svg).call(zoomRef.current.transform, next)
  }, [])

  const zoomBy = (factor: number) => {
    const svg = svgRef.current
    if (svg && zoomRef.current) select(svg).call(zoomRef.current.scaleBy, factor)
  }

  const zoomTo = useCallback(
    (id: string) => {
      const shape = shapeById.get(id)
      if (!shape) return
      const [[x0, y0], [x1, y1]] = shape.bounds
      const k = Math.max(1, Math.min(maxZoom, 0.7 / Math.max((x1 - x0) / width, (y1 - y0) / height, 1e-6)))
      const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2]
      applyZoom(zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-cx, -cy))
    },
    [applyZoom, height, maxZoom, shapeById, width],
  )

  useEffect(() => {
    if (focusRequest) zoomTo(focusRequest.id)
  }, [focusRequest, zoomTo])

  /** A point in map coordinates (after zoom) as a CSS position inside the wrapper; the SVG scales with its width. */
  const toPercent = (x: number, y: number) => ({
    left: clampLeft(`${(transform.applyX(x) / width) * 100}%`),
    top: `calc(${(transform.applyY(y) / height) * 100}% + 14px)`,
  })

  const pointer = (event: React.PointerEvent<SVGGElement>) => {
    const target = event.target as SVGElement
    const id = target.dataset.id
    const markerId = target.dataset.markerId
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || (!id && !markerId)) {
      setHover(null)
      return
    }
    setHover({ id: (markerId ?? id)!, marker: Boolean(markerId), x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  const click = (event: React.MouseEvent<SVGGElement>) => {
    const target = event.target as SVGElement
    if (target.dataset.markerId && onMarkerSelect) {
      onMarkerSelect(target.dataset.markerId)
      return
    }
    const id = target.dataset.id
    if (id) {
      setFocusedId(id)
      onSelect(id)
    }
  }

  const focusFeature = (id: string) => {
    setFocusedId(id)
    const element = svgRef.current?.querySelector<SVGPathElement>(`path[data-id="${id}"]`)
    element?.focus({ preventScroll: true })
  }

  const keyDown = (event: React.KeyboardEvent<SVGGElement>) => {
    const current = (event.target as SVGElement).dataset.id ?? tabStopId
    const index = current ? order.indexOf(current) : -1
    const move = (to: number) => {
      event.preventDefault()
      focusFeature(order[(to + order.length) % order.length])
    }
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        return move(index + 1)
      case 'ArrowLeft':
      case 'ArrowUp':
        return move(index - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(order.length - 1)
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (current) onSelect(current)
        return
      case 'Escape':
        if (selectedId) {
          event.preventDefault()
          onSelect(null)
        }
        return
      default:
        if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now()
          const t = typeahead.current
          t.text = now - t.at < 700 ? t.text + event.key.toLowerCase() : event.key.toLowerCase()
          t.at = now
          // Repeating one letter ("kk") cycles through the names starting with it, as in a native listbox.
          const query = /^(.)\1*$/u.test(t.text) ? t.text[0] : t.text
          const names = order.map((id) => byId.get(id)!.name.toLowerCase())
          const start = query.length === 1 ? index + 1 : index
          for (let i = 0; i < order.length; i += 1) {
            const j = (start + i) % order.length
            if (names[j].startsWith(query)) return move(j)
          }
        }
    }
  }

  const focusTip = focusedId && !hover ? shapeById.get(focusedId) : null
  const tip = hover
    ? {
        content: hover.marker ? markers.find((m) => m.id === hover.id)?.label : byId.get(hover.id) ? tooltip(byId.get(hover.id)!) : null,
        position: { left: clampLeft(`${hover.x}px`), top: hover.y + 14 },
      }
    : focusTip
      ? { content: tooltip(byId.get(focusTip.id)!), position: toPercent(...focusTip.centroid) }
      : null

  const projectedMarkers = useMemo(
    () =>
      markers
        .map((m) => ({ marker: m, point: projection([m.longitude, m.latitude]) }))
        .filter((m): m is { marker: MapMarker; point: [number, number] } => m.point !== null),
    [markers, projection],
  )

  const k = transform.k
  const overlay = (id: string | null, stroke: string, strokeWidth: number) => {
    const shape = id ? shapeById.get(id) : null
    return shape ? (
      <path d={shape.d} fill="none" stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" pointerEvents="none" />
    ) : null
  }

  return (
    <div className="relative" data-testid={`geo-map-${kind}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full touch-pan-y select-none"
        aria-labelledby={`${uid}-label`}
        aria-describedby={`${uid}-help`}
      >
        <title id={`${uid}-label`}>{label}</title>
        <desc id={`${uid}-help`}>
          Use the arrow keys to move between areas, Enter to select, Escape to clear. Hold Ctrl or Cmd and scroll, pinch with two fingers, or use the zoom buttons to zoom.
        </desc>
        <g transform={transform.toString()}>
          {sphere ? <path d={sphere} fill="var(--map-ocean)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
          <g
            role="listbox"
            aria-label={label}
            onPointerMove={pointer}
            onPointerLeave={() => setHover(null)}
            onClick={click}
            onKeyDown={keyDown}
            onFocus={(event) => setFocusedId((event.target as SVGElement).dataset.id ?? null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null)
            }}
          >
            <FeatureLayer shapes={shapes} fills={fills} descriptions={descriptions} selectedId={selectedId} tabStopId={tabStopId} />
          </g>
          {overlay(hover && !hover.marker ? hover.id : null, 'var(--map-hover)', 1.5)}
          {overlay(focusedId, 'var(--ring)', 2.5)}
          {overlay(selectedId, 'var(--map-selected)', 2.25)}
          <g aria-hidden="true" onPointerMove={pointer} onPointerLeave={() => setHover(null)} onClick={click}>
            {projectedMarkers.map(({ marker, point: [x, y] }) => {
              const r = (marker.emphasised ? 6.5 : 5) / k
              return (
                <g key={marker.id} className="cursor-pointer">
                  <circle cx={x} cy={y} r={r + 2 / k} fill="var(--surface)" pointerEvents="none" />
                  <circle
                    data-marker-id={marker.id}
                    data-testid="map-marker"
                    data-filled={marker.fill ? 'true' : 'false'}
                    cx={x}
                    cy={y}
                    r={r}
                    fill={marker.fill ?? 'var(--surface)'}
                    stroke="var(--foreground)"
                    strokeWidth={marker.fill ? 1 : 1.75}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Larger invisible hit target than the mark. */}
                  <circle data-marker-id={marker.id} cx={x} cy={y} r={Math.max(r * 2, 9 / k)} fill="transparent" />
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {tip?.content ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 rounded-md border bg-surface px-3 py-2 text-sm shadow-md"
          style={tip.position}
        >
          {tip.content}
        </div>
      ) : null}

      <div className="absolute top-2 right-2 flex flex-col overflow-hidden rounded-md border bg-surface/95 shadow-sm">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in" className="grid size-10 place-items-center hover:bg-muted">
          <Plus aria-hidden="true" className="size-4" />
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" className="grid size-10 place-items-center border-t hover:bg-muted">
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <button type="button" onClick={() => applyZoom(zoomIdentity)} aria-label="Reset map view" className="grid size-10 place-items-center border-t hover:bg-muted">
          <RotateCcw aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  )
}
