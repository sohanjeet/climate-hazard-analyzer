import type { CityResult } from '@/lib/comparison'

/**
 * CSV export of a comparison. One row per location and year, straight from the API responses (nothing
 * recomputed). Every row states its scope so a spreadsheet cannot lose the "not a state aggregate" context.
 */

type Cell = string | number | boolean | null

/** RFC 4180 quoting, plus protection against spreadsheet formula injection in text cells. */
export function csvCell(value: Cell): string {
  if (value === null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  // A text cell starting with = + - @ (or tab / CR) can run as a formula in Excel, Sheets or LibreOffice.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const COMPARISON_CSV_HEADER = [
  'scope',
  'area_code',
  'area_name',
  'location_name',
  'latitude',
  'longitude',
  'year',
  'heatwave_year_complete',
  'heatwave_events',
  'heatwave_days',
  'mean_event_duration_days',
  'max_event_duration_days',
  'annual_mean_daily_max_c',
  'anomaly_c',
  'anomaly_year_status',
  'baseline',
] as const

export interface CsvArea {
  /** Location id (CityResult.location.id) -> the area it represents. */
  code: string
  name: string
}

export function buildComparisonCsv(cities: readonly CityResult[], areaFor: (city: CityResult) => CsvArea): string {
  const rows: Cell[][] = [[...COMPARISON_CSV_HEADER]]
  for (const city of cities) {
    const heat = city.heatwave.status === 'success' ? city.heatwave.data : null
    const anomaly = city.anomaly.status === 'success' ? city.anomaly.data : null
    if (!heat && !anomaly) continue
    const years = [...new Set([...(heat?.annual ?? []).map((r) => r.year), ...(anomaly?.annual ?? []).map((r) => r.year)])].sort((a, b) => a - b)
    const area = areaFor(city)
    const baseline = heat ? `${heat.baseline.start_year}-${heat.baseline.end_year}` : anomaly ? `${anomaly.baseline.start_year}-${anomaly.baseline.end_year}` : null
    for (const year of years) {
      const h = heat?.annual.find((r) => r.year === year)
      const a = anomaly?.annual.find((r) => r.year === year)
      rows.push([
        'observation_location (not an area aggregate)',
        area.code,
        area.name,
        city.location.name,
        city.location.latitude,
        city.location.longitude,
        year,
        h ? h.is_complete : null,
        h ? h.heatwave_count : null,
        h ? h.total_heatwave_days : null,
        h?.mean_duration_days ?? null,
        h?.max_duration_days ?? null,
        a?.annual_mean_daily_max_c ?? null,
        a?.anomaly_c ?? null,
        a?.status ?? null,
        baseline,
      ])
    }
  }
  return toCsv(rows)
}

/** Saves text as a file through a temporary object URL. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
