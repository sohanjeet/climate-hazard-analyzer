import { useId, useMemo, useState } from 'react'
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchPlaces, type Searchable } from '@/lib/geo/search'

interface PlaceSearchProps<T extends Searchable> {
  items: readonly T[]
  label: string
  placeholder?: string
  onPick: (item: T) => void
  /** Secondary text for an option, e.g. an ISO code. */
  meta?: (item: T) => string | null
  isDisabled?: (item: T) => string | null
  disabled?: boolean
}

/**
 * Editable combobox with a list of matches (WAI-ARIA 1.2 combobox pattern). Matching is local, accent- and
 * case-insensitive, and also accepts exact codes (IND, IN-RJ).
 */
export function PlaceSearch<T extends Searchable>({ items, label, placeholder, onPick, meta, isDisabled, disabled = false }: PlaceSearchProps<T>) {
  const uid = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const results = useMemo(() => searchPlaces(items, debounced), [items, debounced])
  const expanded = open && query.trim().length > 0 && debounced === query

  function pick(item: T) {
    if (isDisabled?.(item)) return
    onPick(item)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      if (expanded && results[active]) {
        event.preventDefault()
        pick(results[active])
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      } else setQuery('')
    }
  }

  const status = !query.trim() || debounced !== query ? '' : results.length === 0 ? 'No matches.' : `${results.length} match${results.length === 1 ? '' : 'es'}. Use the arrow keys to choose.`

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label htmlFor={`${uid}-input`}>{label}</Label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`${uid}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${uid}-list`}
          aria-activedescendant={expanded && results[active] ? `${uid}-option-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-9"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          onFocus={() => setOpen(true)}
        />
      </div>
      <ul
        id={`${uid}-list`}
        role="listbox"
        aria-label={`${label} results`}
        hidden={!expanded || results.length === 0}
        className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border bg-surface p-1 shadow-lg"
      >
        {results.map((item, index) => {
          const disabledReason = isDisabled?.(item) ?? null
          return (
            <li
              key={item.id}
              id={`${uid}-option-${index}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={disabledReason ? true : undefined}
              // mousedown, not click: it fires before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(item)
              }}
              onMouseEnter={() => setActive(index)}
              className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-selected:bg-muted"
            >
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{disabledReason ?? meta?.(item)}</span>
            </li>
          )
        })}
      </ul>
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
    </div>
  )
}
