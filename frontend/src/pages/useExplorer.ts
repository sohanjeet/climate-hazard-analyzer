import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_FETCHERS, type ComparisonFetchers } from '@/hooks/useComparison'
import { DEFAULT_GEOGRAPHY_API, useCoverage, useObservationLocations, type GeographyApi } from '@/hooks/useGeography'
import { analysisKey, useLocationAnalyses } from '@/hooks/useLocationAnalyses'
import { createCachedFetchers } from '@/lib/analysisCache'
import type { ObservationLocation } from '@/lib/api/types'
import { indicatorById, indicatorValue, scaleFor, type IndicatorId, type IndicatorValue } from '@/lib/geo/indicators'
import { defaultYearRange, toDateRange, yearRangeProblem, type YearRange } from '@/lib/geo/period'

/** One cache for the whole session, shared by every map and comparison page. */
export const SHARED_FETCHERS: ComparisonFetchers = createCachedFetchers(DEFAULT_FETCHERS)

export interface GeoPageProps {
  fetchers?: ComparisonFetchers
  geography?: GeographyApi
  now?: Date
}

/** Shared state of the two explorer pages: period, indicator, catalog, coverage and on-demand analyses. */
export function useExplorer({ fetchers = SHARED_FETCHERS, geography = DEFAULT_GEOGRAPHY_API, now }: GeoPageProps, scope: { country?: string }) {
  const [years, setYears] = useState<YearRange>(() => defaultYearRange(now))
  const [indicator, setIndicator] = useState<IndicatorId>('heatwave_days')
  const problem = yearRangeProblem(years, now)
  const range = useMemo(() => toDateRange(years), [years])
  const [catalog, retryCatalog] = useObservationLocations(geography)
  const analyses = useLocationAnalyses(fetchers)
  const coverageRequest = useMemo(() => (problem ? null : { ...range, country: scope.country }), [problem, range, scope.country])
  const [coverage, retryCoverage] = useCoverage(geography, coverageRequest, analyses.completed)

  const allLocations = useMemo(() => {
    if (catalog.status !== 'success') return []
    return catalog.data.locations.filter((l) => !scope.country || l.country_code === scope.country)
  }, [catalog, scope.country])

  const coverageFor = useCallback(
    (location: ObservationLocation) => (coverage.status === 'success' ? coverage.data?.get(location.id) : undefined),
    [coverage],
  )
  const resultFor = useCallback((location: ObservationLocation) => analyses.results[analysisKey(location.id, range)], [analyses.results, range])
  const valueFor = useCallback((location: ObservationLocation): IndicatorValue => indicatorValue(indicator, resultFor(location)), [indicator, resultFor])

  const analysedValues = useMemo(
    () =>
      allLocations.flatMap((location) => {
        const v = valueFor(location)
        return v.kind === 'value' ? [{ location, value: v.value }] : []
      }),
    [allLocations, valueFor],
  )
  const scale = useMemo(() => scaleFor(indicatorById(indicator), analysedValues.map((v) => v.value)), [indicator, analysedValues])

  const analyze = useCallback(
    (locations: readonly ObservationLocation[]) => {
      if (!problem) analyses.analyze(locations, range)
    },
    [analyses, problem, range],
  )

  return {
    years, setYears, indicator, setIndicator, problem, range,
    catalog, retryCatalog, coverage, retryCoverage, allLocations,
    coverageFor, resultFor, valueFor, analysedValues, scale, analyze,
  }
}

export type ExplorerState = ReturnType<typeof useExplorer>
