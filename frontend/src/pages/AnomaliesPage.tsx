import { Suspense, lazy, useId, useMemo, useState } from 'react'
import { Loader2, Thermometer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAnomalyAnalysis, type AnomalyFetcher } from '@/hooks/useAnomalyAnalysis'
import { fetchTemperatureAnomalies } from '@/lib/api/client'
import { PRESET_LOCATIONS } from '@/lib/comparison'
import { LIMITS, defaultFormValues, latestArchiveDate, parseCoordinate, validateDateRange } from '@/lib/validation'
import { PageHeader } from '@/pages/PageHeader'

const AnomalySection = lazy(() => import('@/components/AnomalySection').then((m) => ({ default: m.AnomalySection })))

type Errors = Partial<Record<'latitude' | 'longitude' | 'startDate' | 'endDate', string>>

/** Temperature anomalies on their own, for one location (the dashboard shows them next to heatwaves). */
export default function AnomaliesPage({ fetcher = fetchTemperatureAnomalies, now }: { fetcher?: AnomalyFetcher; now?: Date }) {
  const uid = useId()
  const defaults = useMemo(() => defaultFormValues(now), [now])
  const { part, run, retry, cancel } = useAnomalyAnalysis(fetcher)
  const [values, setValues] = useState({ latitude: defaults.latitude, longitude: defaults.longitude, startDate: defaults.startDate, endDate: defaults.endDate })
  const [errors, setErrors] = useState<Errors>({})
  const busy = part.status === 'loading'

  function set(field: keyof typeof values, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const lat = parseCoordinate(values.latitude, 'latitude', LIMITS.latitude.min, LIMITS.latitude.max)
    const lon = parseCoordinate(values.longitude, 'longitude', LIMITS.longitude.min, LIMITS.longitude.max)
    const next: Errors = { ...validateDateRange(values.startDate, values.endDate, now) }
    if (lat.error) next.latitude = lat.error
    if (lon.error) next.longitude = lon.error
    setErrors(next)
    if (Object.values(next).some(Boolean) || lat.value === undefined || lon.value === undefined) return
    void run({ latitude: lat.value, longitude: lon.value, startDate: values.startDate, endDate: values.endDate })
  }

  const field = (name: keyof Errors, label: string, props: React.ComponentProps<'input'>) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${uid}-${name}`}>{label}</Label>
      <Input id={`${uid}-${name}`} value={values[name]} onChange={(e) => set(name, e.target.value)}
        aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? `${uid}-${name}-error` : undefined} {...props} />
      {errors[name] ? <p id={`${uid}-${name}-error`} role="alert" className="text-sm font-medium text-danger-foreground">{errors[name]}</p> : null}
    </div>
  )

  return (
    <div>
      <PageHeader title="Temperature anomalies" icon={Thermometer}>
        How much warmer or cooler each year’s average daily high was than the same location’s 1991–2020 average. One location at a time;
        the value is for the nearest reanalysis grid cell.
      </PageHeader>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[21.5rem_minmax(0,1fr)] lg:items-start lg:gap-12">
        <form noValidate onSubmit={submit} aria-label="Anomaly analysis" className="@container flex flex-col gap-5 rounded-lg border bg-surface p-5 lg:sticky lg:top-20">
          <fieldset className="flex flex-wrap gap-2" disabled={busy}>
            <legend className="mb-2 text-sm font-semibold">Example locations</legend>
            {PRESET_LOCATIONS.map((p) => (
              <Button key={p.name} type="button" variant="outline" size="sm" onClick={() => setValues((v) => ({ ...v, latitude: String(p.latitude), longitude: String(p.longitude) }))}>
                {p.name}
              </Button>
            ))}
          </fieldset>
          <fieldset className="grid grid-cols-1 gap-4 @xs:grid-cols-2" disabled={busy}>
            <legend className="sr-only">Coordinates</legend>
            {field('latitude', 'Latitude', { inputMode: 'decimal', autoComplete: 'off' })}
            {field('longitude', 'Longitude', { inputMode: 'decimal', autoComplete: 'off' })}
          </fieldset>
          <fieldset className="grid grid-cols-1 gap-4 @xs:grid-cols-2" disabled={busy}>
            <legend className="sr-only">Period</legend>
            {field('startDate', 'Start date', { type: 'date', min: LIMITS.archiveStart, max: latestArchiveDate(now) })}
            {field('endDate', 'End date', { type: 'date', min: LIMITS.archiveStart, max: latestArchiveDate(now) })}
          </fieldset>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Thermometer aria-hidden="true" />}
            {busy ? 'Analysing…' : 'Show anomalies'}
          </Button>
          {busy ? <Button type="button" variant="outline" onClick={cancel}><X aria-hidden="true" />Cancel</Button> : null}
        </form>

        <div className="min-w-0">
          {part.status === 'idle' ? (
            <p className="rounded-lg border border-dashed px-6 py-12 text-[0.9375rem] text-muted-foreground">
              Choose a location and a period of full calendar years, then show the anomalies. Years that are incomplete keep their mean but get no anomaly.
            </p>
          ) : (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <AnomalySection part={part} onRetry={retry} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  )
}
