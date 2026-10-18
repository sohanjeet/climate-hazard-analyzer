import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { SeriesSwatch } from '@/components/compare/series'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCoordinates } from '@/lib/format'
import {
  MAX_LOCATIONS,
  MIN_LOCATIONS,
  PRESET_LOCATIONS,
  addLocation,
  locationId,
  removeLocation,
  validateCustomLocation,
  type ComparisonLocation,
  type CustomLocationErrors,
} from '@/lib/comparison'

interface LocationPickerProps {
  locations: ComparisonLocation[]
  onChange: (locations: ComparisonLocation[]) => void
  disabled?: boolean
}

/** Preset checkboxes, a custom-coordinate form and the removable list of selected locations (2 to 4). */
export function LocationPicker({ locations, onChange, disabled = false }: LocationPickerProps) {
  const uid = useId()
  const [custom, setCustom] = useState({ name: '', latitude: '', longitude: '' })
  const [customErrors, setCustomErrors] = useState<CustomLocationErrors>({})
  const [notice, setNotice] = useState<string | null>(null)

  function togglePreset(preset: (typeof PRESET_LOCATIONS)[number], checked: boolean) {
    setNotice(null)
    const id = locationId(preset.latitude, preset.longitude)
    if (!checked) {
      onChange(removeLocation(locations, id))
      return
    }
    const result = addLocation(locations, preset)
    if (result.ok) onChange(result.locations)
    else setNotice(result.error)
  }

  // Not a nested <form>: the picker lives inside the comparison form, so Enter in a field adds the location.
  function submitCustom() {
    setNotice(null)
    const { errors, candidate } = validateCustomLocation(custom)
    setCustomErrors(errors)
    if (!candidate) return
    const result = addLocation(locations, candidate)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    onChange(result.locations)
    setCustom({ name: '', latitude: '', longitude: '' })
  }

  function onEnter(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    submitCustom()
  }

  function setField(field: keyof typeof custom, value: string) {
    setCustom((previous) => ({ ...previous, [field]: value }))
    setCustomErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const fieldProps = (field: keyof CustomLocationErrors) => ({
    id: `${uid}-${field}`,
    'aria-invalid': customErrors[field] ? (true as const) : undefined,
    'aria-describedby': customErrors[field] ? `${uid}-${field}-error` : undefined,
  })
  const fieldError = (field: keyof CustomLocationErrors) =>
    customErrors[field] ? (
      <p id={`${uid}-${field}-error`} role="alert" className="text-sm font-medium text-danger-foreground">
        {customErrors[field]}
      </p>
    ) : null

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-2 text-sm font-semibold text-foreground">Preset cities</legend>
        {PRESET_LOCATIONS.map((preset) => {
          const id = locationId(preset.latitude, preset.longitude)
          const checked = locations.some((l) => l.id === id)
          return (
            <label key={id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-base">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={checked}
                onChange={(event) => togglePreset(preset, event.target.checked)}
              />
              <span>{preset.name}</span>
              <span className="tabular text-sm text-muted-foreground">{formatCoordinates(preset.latitude, preset.longitude)}</span>
            </label>
          )
        })}
      </fieldset>

      <div role="group" aria-label="Add a custom location" onKeyDown={onEnter} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-4" disabled={disabled}>
          <legend className="mb-1 text-sm font-semibold text-foreground">Custom location</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-name`}>Name (optional)</Label>
            <Input {...fieldProps('name')} autoComplete="off" maxLength={80} value={custom.name} onChange={(e) => setField('name', e.target.value)} />
            {fieldError('name')}
          </div>
          <div className="grid grid-cols-1 gap-4 @xs:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-latitude`}>Custom latitude</Label>
              <Input {...fieldProps('latitude')} inputMode="decimal" autoComplete="off" value={custom.latitude} onChange={(e) => setField('latitude', e.target.value)} />
              <p className="text-sm text-muted-foreground">−90 to 90</p>
              {fieldError('latitude')}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-longitude`}>Custom longitude</Label>
              <Input {...fieldProps('longitude')} inputMode="decimal" autoComplete="off" value={custom.longitude} onChange={(e) => setField('longitude', e.target.value)} />
              <p className="text-sm text-muted-foreground">−180 to 180</p>
              {fieldError('longitude')}
            </div>
          </div>
          <Button type="button" variant="outline" disabled={disabled} onClick={submitCustom}>
            <Plus aria-hidden="true" />
            Add location
          </Button>
        </fieldset>
      </div>

      <div role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-danger-foreground">
        {notice}
      </div>

      <section aria-labelledby={`${uid}-selected`} className="flex flex-col gap-2">
        <h2 id={`${uid}-selected`} className="text-sm font-semibold text-foreground">
          Selected locations{' '}
          <span className="font-normal text-muted-foreground">
            ({locations.length} of {MAX_LOCATIONS}; choose {MIN_LOCATIONS} to {MAX_LOCATIONS})
          </span>
        </h2>
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations selected yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {locations.map((location) => (
              <li key={location.id} className="flex items-center gap-3 rounded-md border bg-surface py-1 pr-1 pl-3">
                <SeriesSwatch slot={location.slot} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{location.name}</span>
                  <span className="tabular block text-sm text-muted-foreground">
                    {formatCoordinates(location.latitude, location.longitude)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Remove ${location.name}`}
                  onClick={() => {
                    setNotice(null)
                    onChange(removeLocation(locations, location.id))
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
