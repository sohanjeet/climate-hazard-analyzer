import { BookOpen } from 'lucide-react'
import sources from '@/data/geo/sources.json'
import { Link } from '@/components/Link'
import { PageHeader } from '@/pages/PageHeader'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t pt-8">
      <h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex max-w-prose flex-col gap-3 text-[0.9375rem] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

/** The method in one place: heatwaves, anomalies, trends, and what the map pages may and may not claim. */
export default function MethodologyPage() {
  return (
    <div>
      <PageHeader title="Methodology" icon={BookOpen}>
        How every number in this app is produced, what it describes and what it does not. The dashboard also shows the exact parameters returned
        with each result.
      </PageHeader>

      <div className="mt-10 flex flex-col gap-10">
        <Section id="m-point" title="What a value describes">
          <p>
            Every analysis is for one point: the Open-Meteo historical-archive reanalysis grid cell nearest the chosen coordinates (variable
            daily maximum 2 m temperature, UTC days). It is not a weather station and not an area average. Coastal and island points can fall in
            a cell that is partly sea.
          </p>
        </Section>

        <Section id="m-heatwave" title="Heatwaves">
          <p>
            A heatwave is 3 or more consecutive days on which the daily maximum is strictly above the location’s 95th percentile of daily
            maxima over a fixed 1991–2020 baseline (linear interpolation). The same threshold applies to every year, so years are comparable.
          </p>
          <p>
            Missing days are never filled in: a missing day ends a run, so counts can be underestimates. An event belongs to the year in which it
            starts. A year is complete only if it lies wholly inside the period and at least 95% of its days are valid; the baseline needs at
            least 90%. Incomplete years are shown but excluded from per-year values and trends.
          </p>
        </Section>

        <Section id="m-anomaly" title="Temperature anomalies">
          <p>
            Anomaly = the year’s mean daily maximum minus the location’s mean daily maximum over 1991–2020. Positive means warmer than its own
            baseline. Only complete years (95% valid days) get an anomaly. It is not the mean air temperature and not the hottest day.
          </p>
        </Section>

        <Section id="m-trend" title="Trends">
          <p>
            Ordinary least squares of each annual metric on the calendar year, with a two-sided t-test at the 0.05 level, using complete years
            only (3 at least; fewer than 10 is flagged as low power). Serial correlation is not modelled, so p-values may be too small. A trend is
            an association for one grid cell over the chosen period, not a cause and not a forecast. The API does not compute a temperature
            (anomaly) trend, so the maps list it as unavailable rather than estimating one in the browser.
          </p>
        </Section>

        <Section id="m-geo" title="Countries, states and the maps">
          <p>
            The map pages use a curated set of observation locations. India has one for each of its 36 states and union territories: the capital
            where it lies inside the territory, otherwise a major city (Punjab and Haryana share Chandigarh, a separate union territory, so they use
            Ludhiana and Hisar). Other countries have one or two locations each; many have none.
          </p>
          <p>
            <strong className="text-foreground">No country-wide or state-wide value is computed anywhere.</strong> A state is represented by
            one point, and every panel, chart and CSV export labels it as an observation location. Map areas are coloured only by whether data is
            available; climate values appear on point markers. Nothing is downloaded until you ask for an analysis.
          </p>
          <p>
            A real state-level metric would need many sampled grid cells inside the boundary, metrics computed per cell and then aggregated with
            area weights (or population weights for exposure, never mixed), coverage thresholds and published metadata. That is a separate,
            larger piece of work and is not implemented. The design is in docs/geospatial_architecture.md in the repository.
          </p>
        </Section>

        <Section id="m-boundaries" title="Boundary data and licences">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {Object.values(sources.sources).map((s) => (
              <li key={s.url}>
                <span className="text-foreground">{s.title}</span> ({s.version}). {s.license}. {s.attribution}{' '}
                <a href={s.licenseUrl} className="text-primary underline underline-offset-4" rel="noreferrer" target="_blank">Licence</a>
              </li>
            ))}
          </ul>
          <p>
            Coordinates are WGS 84 longitude/latitude ({sources.crs}). The world map uses Natural Earth’s India point of view so that it matches
            the India map; boundaries are for navigation only and imply no position on disputed territory. Four ISO 3166-2:IN codes are updated to
            the current ones ({Object.entries(sources.isoCodeUpdates).map(([from, to]) => `${from} → ${to}`).join(', ')}). The world map
            generalises coastlines by up to about 20 km and omits islands under 150 km²; the India map is simplified to about 1 km.
          </p>
        </Section>

        <p className="border-t pt-8 text-[0.9375rem]">
          <Link to="/" className="font-semibold text-primary underline underline-offset-4">Run an analysis on the dashboard</Link>
        </p>
      </div>
    </div>
  )
}
