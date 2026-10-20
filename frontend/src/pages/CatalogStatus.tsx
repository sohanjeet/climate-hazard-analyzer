import { AlertTriangle, RotateCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useSlowHint } from '@/hooks/useSlowHint'
import type { ExplorerState } from '@/pages/useExplorer'

/** Loading and failure states of the catalog and coverage requests, shown under the map (which works without them). */
export function CatalogStatus({ ex }: { ex: ExplorerState }) {
  const slow = useSlowHint(ex.catalog.status === 'loading')
  if (ex.catalog.status === 'loading') {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading observation locations…
        {slow && ' The server may be waking up after a period of inactivity. This can take up to a minute on the first visit; the map keeps working meanwhile.'}
      </p>
    )
  }
  if (ex.catalog.status === 'error') {
    const timedOut = ex.catalog.error.kind === 'timeout'
    return (
      <Alert variant="danger" icon={<AlertTriangle aria-hidden="true" />} role="alert">
        <AlertTitle>Observation locations could not be loaded</AlertTitle>
        <AlertDescription>
          <p>
            {timedOut
              ? 'The server did not answer within 90 seconds. It may still be starting up, so trying again usually works. The map still works, but no location data can be shown.'
              : 'The map still works, but no location data can be shown.'}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={ex.retryCatalog}><RotateCw aria-hidden="true" />Try again</Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (ex.coverage.status === 'error') {
    return (
      <p className="text-sm text-warning-foreground" role="status">
        Stored-data coverage is unavailable right now, so areas show only whether a location exists.{' '}
        <button type="button" className="font-semibold underline underline-offset-4" onClick={ex.retryCoverage}>Retry</button>
      </p>
    )
  }
  return null
}
