/** Case- and accent-insensitive matching for the geographic search boxes ("sao" finds São Paulo). */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export interface Searchable {
  id: string
  name: string
  /** Extra exact-match keys such as ISO codes. */
  codes?: (string | null | undefined)[]
}

/** Prefix matches on a word first, then substring matches; codes match exactly. Alphabetical inside each group. */
export function searchPlaces<T extends Searchable>(items: readonly T[], query: string, limit = 8): T[] {
  const q = foldText(query)
  if (!q) return []
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const name = foldText(item.name)
    const codeHit = item.codes?.some((code) => code && foldText(code) === q)
    let score = -1
    if (codeHit) score = 0
    else if (name.startsWith(q)) score = 1
    else if (name.split(/[\s(),-]+/).some((word) => word.startsWith(q))) score = 2
    else if (name.includes(q)) score = 3
    if (score >= 0) scored.push({ item, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((s) => s.item)
}
