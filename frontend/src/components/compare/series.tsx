import { styleFor, type MarkerShape } from '@/lib/seriesStyle'

export function Marker({ shape, cx, cy, r, color }: { shape: MarkerShape; cx: number; cy: number; r: number; color: string }) {
  // A 2px surface ring keeps overlapping markers apart.
  const common = { fill: color, stroke: 'var(--surface)', strokeWidth: 1.5 }
  switch (shape) {
    case 'square':
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1} {...common} />
    case 'triangle':
      return <path d={`M${cx} ${cy - r - 1}L${cx + r + 1} ${cy + r}L${cx - r - 1} ${cy + r}Z`} {...common} />
    case 'diamond':
      return <path d={`M${cx} ${cy - r - 1.5}L${cx + r + 1.5} ${cy}L${cx} ${cy + r + 1.5}L${cx - r - 1.5} ${cy}Z`} {...common} />
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />
  }
}

/** Legend glyph: the same line dash and marker as the chart. */
export function SeriesSwatch({ slot }: { slot: number }) {
  const style = styleFor(slot)
  return (
    <svg aria-hidden="true" width="30" height="14" viewBox="0 0 30 14" className="shrink-0">
      <line x1="1" y1="7" x2="29" y2="7" stroke={style.color} strokeWidth="2.25" strokeDasharray={style.dash} strokeLinecap="round" />
      <Marker shape={style.shape} cx={15} cy={7} r={4} color={style.color} />
    </svg>
  )
}
