import { useEffect, useId, useRef, useState } from 'react'
import { CalendarRange, Loader2, MapPin, Play, X } from 'lucide-react'
import { InfoTip } from '@/components/InfoTip'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HeatwaveRequest } from '@/lib/api/types'
import {
  LIMITS,
  ROLLING_WINDOW_OPTIONS,
  defaultFormValues,
  fullCalendarYears,
  latestArchiveDate,
  validateForm,
  type FormErrors,
  type FormField,
  type FormValues,
} from '@/lib/validation'
import { cn } from '@/lib/utils'

const FIELD_ORDER: FormField[] = ['latitude', 'longitude', 'startDate', 'endDate', 'rollingWindowYears']

const EXAMPLE_LOCATIONS = [
  { name: 'Delhi', latitude: '28.6139', longitude: '77.2090' },
  { name: 'London', latitude: '51.5074', longitude: '-0.1278' },
  { name: 'Phoenix', latitude: '33.4484', longitude: '-112.0740' },
  { name: 'Sydney', latitude: '-33.8688', longitude: '151.2093' },
] as const

interface AnalysisFormProps {
  onSubmit: (request: HeatwaveRequest) => void
  onCancel: () => void
  busy: boolean
  /** Seconds left before the service will accept another request (from Retry-After). */
  cooldownSeconds: number
  /** Field errors reported by the backend for the last request. */
  serverErrors: FormErrors
  /** Injected for tests; defaults to the real clock. */
  now?: Date
}

export function AnalysisForm({ onSubmit, onCancel, busy, cooldownSeconds, serverErrors, now }: AnalysisFormProps) {
  const [values, setValues] = useState<FormValues>(() => defaultFormValues(now))
  const [errors, setErrors] = useState<FormErrors>({})
  const formId = useId()
  const refs = useRef<Partial<Record<FormField, HTMLInputElement | HTMLSelectElement | null>>>({})

  // Adopt backend field errors during render (React's "adjust state on prop change" pattern), then focus the first.
  const [adoptedServerErrors, setAdoptedServerErrors] = useState<FormErrors>({})
  if (adoptedServerErrors !== serverErrors) {
    setAdoptedServerErrors(serverErrors)
    if (Object.keys(serverErrors).length > 0) setErrors((previous) => ({ ...previous, ...serverErrors }))
  }
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => serverErrors[field])
    if (first) refs.current[first]?.focus()
  }, [serverErrors])

  const archiveEnd = latestArchiveDate(now)
  const fullYears = fullCalendarYears(values.startDate, values.endDate)
  const rangeIsValid = !errors.startDate && !errors.endDate && values.startDate !== '' && values.endDate !== ''

  function update(field: FormField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => {
      if (!previous[field] && !(field === 'startDate' && previous.endDate) && !(field === 'endDate' && previous.startDate)) {
        return previous
      }
      const next = { ...previous }
      delete next[field]
      // Start/end errors can depend on each other (order and span), so editing one clears both.
      if (field === 'startDate' || field === 'endDate') {
        delete next.startDate
        delete next.endDate
      }
      return next
    })
  }

  function applyExample(example: (typeof EXAMPLE_LOCATIONS)[number]) {
    setValues((previous) => ({ ...previous, latitude: example.latitude, longitude: example.longitude }))
    setErrors((previous) => ({ ...previous, latitude: undefined, longitude: undefined }))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || cooldownSeconds > 0) return
    const result = validateForm(values, now)
    setErrors(result.errors)
    if (!result.request) {
      const first = FIELD_ORDER.find((field) => result.errors[field])
      if (first) refs.current[first]?.focus()
      return
    }
    onSubmit({
      latitude: result.request.latitude,
      longitude: result.request.longitude,
      startDate: result.request.startDate,
      endDate: result.request.endDate,
      rollingWindowYears: result.request.rollingWindowYears,
    })
  }

  const fieldProps = (field: FormField) => ({
    id: `${formId}-${field}`,
    'aria-invalid': errors[field] ? (true as const) : undefined,
    'aria-describedby': [errors[field] ? `${formId}-${field}-error` : null, `${formId}-${field}-hint`]
      .filter(Boolean)
      .join(' '),
    ref: (element: HTMLInputElement | HTMLSelectElement | null) => {
      refs.current[field] = element
    },
  })

  const fieldError = (field: FormField) =>
    errors[field] ? (
      <p id={`${formId}-${field}-error`} role="alert" className="text-sm font-medium text-danger-foreground">
        {errors[field]}
      </p>
    ) : null

  const analyzeLabel = cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : busy ? 'Analyzing…' : 'Analyze heatwaves'

  return (
    <form noValidate onSubmit={handleSubmit} aria-label="Analysis controls" className="@container flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${formId}-hazard`}>Hazard</Label>
          <InfoTip label="hazard">
            Heatwave is the only hazard available. A heatwave is at least 3 consecutive days above the location’s 95th-percentile daily maximum temperature.
          </InfoTip>
        </div>
        <Select id={`${formId}-hazard`} aria-describedby={`${formId}-hazard-hint`} defaultValue="heatwave">
          <option value="heatwave">Heatwave</option>
        </Select>
        <p id={`${formId}-hazard-hint`} className="text-sm text-muted-foreground">
          Other hazards are not available yet.
        </p>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <MapPin aria-hidden="true" className="size-4 text-muted-foreground" />
          Location
        </legend>
        <div className="grid grid-cols-1 gap-4 @xs:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-latitude`}>Latitude</Label>
            <Input {...fieldProps('latitude')} inputMode="decimal" autoComplete="off" value={values.latitude} onChange={(e) => update('latitude', e.target.value)} />
            <p id={`${formId}-latitude-hint`} className="text-sm text-muted-foreground">
              −90 to 90
            </p>
            {fieldError('latitude')}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-longitude`}>Longitude</Label>
            <Input {...fieldProps('longitude')} inputMode="decimal" autoComplete="off" value={values.longitude} onChange={(e) => update('longitude', e.target.value)} />
            <p id={`${formId}-longitude-hint`} className="text-sm text-muted-foreground">
              −180 to 180
            </p>
            {fieldError('longitude')}
          </div>
        </div>
        <div role="group" aria-label="Example locations" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted-foreground">
          <span className="mr-1">Try:</span>
          {EXAMPLE_LOCATIONS.map((example) => (
            <Button key={example.name} type="button" variant="ghost" size="sm" className="min-h-9 px-2.5" onClick={() => applyExample(example)}>
              {example.name}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarRange aria-hidden="true" className="size-4 text-muted-foreground" />
          Analysis period
        </legend>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-startDate`}>Start date</Label>
            <Input {...fieldProps('startDate')} type="date" min={LIMITS.archiveStart} max={archiveEnd} value={values.startDate} onChange={(e) => update('startDate', e.target.value)} />
            <p id={`${formId}-startDate-hint`} className="sr-only">
              Earliest 1 January 1940.
            </p>
            {fieldError('startDate')}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-endDate`}>End date</Label>
            <Input {...fieldProps('endDate')} type="date" min={LIMITS.archiveStart} max={archiveEnd} value={values.endDate} onChange={(e) => update('endDate', e.target.value)} />
            <p id={`${formId}-endDate-hint`} className="sr-only">
              Latest {archiveEnd}. At most {LIMITS.maxAnalysisYears} calendar years.
            </p>
            {fieldError('endDate')}
          </div>
        </div>
        {rangeIsValid ? (
          <p className={cn('text-sm', fullYears < LIMITS.minTrendYears ? 'font-medium text-warning-foreground' : 'text-muted-foreground')}>
            {fullYears === 0
              ? 'This range contains no full calendar year, so no trend can be estimated.'
              : `This range contains ${fullYears} full calendar year${fullYears === 1 ? '' : 's'}.`}{' '}
            {fullYears < LIMITS.minTrendYears
              ? `Trends need at least ${LIMITS.minTrendYears} full years.`
              : 'Only full years count toward trends.'}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${formId}-rollingWindowYears`}>Rolling average window</Label>
          <InfoTip label="rolling average window">
            The rolling mean at each year averages that year and the years before it. It appears only where every year in the window is complete and has a value.
          </InfoTip>
        </div>
        <Select {...fieldProps('rollingWindowYears')} value={values.rollingWindowYears} onChange={(e) => update('rollingWindowYears', e.target.value)}>
          {ROLLING_WINDOW_OPTIONS.map((years) => (
            <option key={years} value={years}>
              {years} years
            </option>
          ))}
        </Select>
        <p id={`${formId}-rollingWindowYears-hint`} className="text-sm text-muted-foreground">
          Trailing mean, {LIMITS.rollingWindow.min} to {LIMITS.rollingWindow.max} years.
        </p>
        {fieldError('rollingWindowYears')}
      </div>

      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={busy || cooldownSeconds > 0} aria-disabled={busy || cooldownSeconds > 0}>
          {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Play aria-hidden="true" />}
          {analyzeLabel}
        </Button>
        {busy ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            <X aria-hidden="true" />
            Cancel
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            The first analysis for a new location downloads 30 years of baseline data and can take 5 to 15 seconds. Repeat runs are much faster.
          </p>
        )}
      </div>
    </form>
  )
}
