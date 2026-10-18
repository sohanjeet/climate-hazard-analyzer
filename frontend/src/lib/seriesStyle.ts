/**
 * Visual identity of a compared location. The colour comes from the validated categorical palette
 * (--series-1..4), but colour is never the only cue: each slot also has its own marker shape and line dash,
 * so lines stay distinguishable in greyscale, with colour-vision deficiency and in print.
 */
export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond'

export interface SeriesStyle {
  color: string
  dash: string | undefined
  shape: MarkerShape
  shapeName: string
}

export const SERIES_STYLES: readonly SeriesStyle[] = [
  { color: 'var(--series-1)', dash: undefined, shape: 'circle', shapeName: 'circle, solid line' },
  { color: 'var(--series-2)', dash: '7 4', shape: 'square', shapeName: 'square, dashed line' },
  { color: 'var(--series-3)', dash: '2 4', shape: 'triangle', shapeName: 'triangle, dotted line' },
  { color: 'var(--series-4)', dash: '9 3 2 3', shape: 'diamond', shapeName: 'diamond, dash-dot line' },
]

export const styleFor = (slot: number): SeriesStyle => SERIES_STYLES[slot % SERIES_STYLES.length]

