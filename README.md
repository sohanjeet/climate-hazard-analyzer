# Climate Hazard Trend Analyzer

A web dashboard that shows how often, how long and how intense heatwaves were at any place on Earth, and whether those numbers are trending up or down over a chosen period. You pick a latitude/longitude and a date window; the backend pulls historical daily maximum temperatures, detects heatwaves against a fixed local threshold, and fits statistical trends. Two views build on that (Phase 9): **annual temperature anomalies** against the same 1991 to 2020 baseline, and a **side-by-side comparison of 2 to 4 locations**. Phase 10 adds **map explorers** (world and India) and a **state comparison**. These work on curated observation locations, and every value they show is a location-level observation, never a country or state average.

> **Status:** development is complete and tested locally. Nothing has been deployed and there is no public URL yet. See [Deployment](#deployment) and [Known limitations](#known-limitations).

## Architecture

```
Browser (React SPA)  --GET /api/heatwaves, /api/temperature-anomalies-->  FastAPI  --GET-->  Open-Meteo archive API
                                                 |
                                                 +--> MongoDB (weather_records, ingestion_cache, analysis_results)
```

- **Frontend** (`frontend/`): static single-page app with seven routes: `/` Dashboard (summary metrics, four charts, a temperature-anomaly section, trend insights, data-quality notes, methodology), `/explore/global`, `/explore/india`, `/compare/cities` (2 to 4 locations), `/compare/states`, `/anomalies` and `/methodology`. It calls the two analysis endpoints and the two read-only geography endpoints, and validates every response at runtime. Map pages, map code and boundary files are lazy-loaded chunks.
- **Backend** (`backend/`): FastAPI service. Loads the baseline (default 1991 to 2020) and the analysis window one calendar year at a time, stores daily records in MongoDB so repeat requests are served from the database, then computes heatwave events, annual metrics and trends.
- **Data source:** [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), variable `temperature_2m_max`, UTC days.
- `docs/phase4a_heatwave_design.md` is the original design note for the heatwave method; `docs/temperature_anomaly_design.md` covers the anomaly method and the comparison design.

## Technology stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn, PyMongo, HTTPX, NumPy, SciPy, pydantic-settings |
| Database | MongoDB (local or Atlas) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Radix UI primitives (shadcn/ui style), Recharts, Lucide |
| Tests | pytest (backend); Vitest + Testing Library, oxlint, tsc, Playwright-core + axe-core browser check (frontend) |

## Local setup

Prerequisites: Python 3.11, Node.js (current LTS), and a running MongoDB (for example `mongodb://localhost:27017`). Internet access is needed for Open-Meteo.

**Backend** (from `backend/`; commands shown for Windows, use `venv/bin/python` on macOS/Linux):

```
python -m venv venv
venv\Scripts\python -m pip install -r requirements-dev.txt   # requirements.txt for runtime only
copy .env.example .env                                       # then edit MONGODB_URI if needed
venv\Scripts\python -m uvicorn app.main:app --port 8000
```

The server fails at startup if MongoDB is unreachable. API docs: http://localhost:8000/docs.

**Frontend** (from `frontend/`):

```
npm install
copy .env.example .env.local        # VITE_API_BASE_URL, default http://localhost:8000
npm run dev                         # http://localhost:5173
```

`http://localhost:5173` is the backend's default `CORS_ALLOWED_ORIGINS`, so the two work together without further configuration.

## Environment variables

Real `.env` / `.env.local` files are git-ignored; only the `.env.example` files are meant to be committed.

**Backend** (`backend/.env.example` lists all of them with defaults):

| Variable | Default | Notes |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017` | **Required in production.** Contains credentials for Atlas (`mongodb+srv://...`). Held as a secret value and never logged. |
| `DATABASE_NAME` | `climate_hazard_db` | |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | **Required in production:** set to the deployed frontend origin (comma-separated). |
| `TRUST_PROXY_HEADERS` | `false` | Set `true` only behind a reverse proxy you control; it makes the rate limiter use the last `X-Forwarded-For` entry. |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS_PER_MINUTE`, `RATE_LIMIT_HEATWAVE_REQUESTS_PER_MINUTE` | `true`, `60`, `20` | Per client IP, in process memory. The last one applies separately to `/api/heatwaves` and `/api/temperature-anomalies`. |
| `WEATHER_FETCH_CONCURRENCY` | `4` | Simultaneous Open-Meteo requests (1 to 8). |
| `OPEN_METEO_TIMEOUT_SECONDS`, `OPEN_METEO_MAX_RETRIES`, `OPEN_METEO_BASE_URL` | `10`, `2`, archive URL | |
| `MONGODB_*_TIMEOUT_MS`, `MONGODB_MAX_POOL_SIZE` | see example file | |
| `LOG_LEVEL` | `INFO` | |

**Frontend** (`frontend/.env.example`):

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL. It is **baked into the bundle at build time**, so set it in the build environment of the host (a rebuild is needed to change it). If unset the app falls back to `http://localhost:8000`, which will not work in production. |

## API endpoints

| Method and path | Purpose |
|---|---|
| `GET /api/heatwaves?latitude&longitude&start_date&end_date[&baseline_start_year&baseline_end_year&rolling_window_years]` | Heatwave events, annual metrics, summary, trend analysis, data quality. Rate limit 20/min per IP by default. |
| `GET /api/temperature-anomalies?latitude&longitude&start_date&end_date[&baseline_start_year&baseline_end_year]` | Annual mean daily maximum temperature and its anomaly against the fixed baseline, with coverage, per-year status and data-quality warnings. Rate limit 20/min per IP by default, in its own bucket. |
| `GET /api/weather?latitude&longitude&start_date&end_date` | Ingest and return daily records (max 366 days). Rate limit 60/min per IP by default. |
| `GET /api/geography/locations[?country&region]` | Curated observation locations (scope `observation_location`). Read-only and static; 60/min bucket. |
| `GET /api/geography/coverage?start_date&end_date[&country&region]` | Stored valid days per catalog location for the baseline and the window (`stored` / `partial` / `not_stored`). One index-only aggregation. Never downloads or computes anything; 60/min bucket. |
| `GET /health` | Liveness. |
| `GET /health/db` | Readiness; `503` when MongoDB is unreachable. |
| `GET /docs`, `/redoc`, `/openapi.json` | Interactive API documentation. |

All errors use `{"detail": {"error": "...", "errors"?: [{"field", "message"}]}}`. Status codes: `422` invalid input, `429` rate limited (with `Retry-After`), `502`/`504` upstream failure or timeout, `503` upstream rate limit or database unavailable (with `Retry-After`). There is no authentication; the API is public and read-only. Full field-level detail is in [backend/README.md](backend/README.md).

## Heatwave methodology

- A **heatwave** is 3 or more consecutive calendar days on which the daily maximum 2 m temperature is **strictly above** the location's 95th-percentile threshold.
- The **threshold** is one all-season 95th percentile (linear interpolation) of daily maxima over a fixed baseline, 1991 to 2020 by default. The same threshold applies to every analysis year, so years are directly comparable.
- The **location** is the single Open-Meteo reanalysis grid cell nearest the coordinates (not a weather station, not an area average).
- **Missing days are never filled in**; a missing day ends a run, so counts can be underestimates. Events next to gaps are flagged.
- An event belongs to the year in which it **starts**. **Intensity** is °C above the threshold.
- A year counts as **complete** only if it lies wholly inside the requested window and has at least 95% valid days. Incomplete years are displayed but excluded from per-year rates and trends. The baseline needs at least 90% valid days and 10 calendar years.

The full method, with its biases, is in [backend/README.md](backend/README.md).

## Temperature anomalies and comparison (Phase 9)

- **Anomaly** = annual mean of the daily maximum temperature minus the mean daily maximum over the fixed baseline (1991 to 2020 by default). Example: 32.4 °C - 30.8 °C = **+1.6 °C**. It is not the mean air temperature, not the hottest day of the year and not the heatwave threshold, and it describes the past rather than predicting anything. The baseline is always shown in the API and the UI.
- **Completeness:** the baseline needs at least 90% valid days (otherwise the API answers `422`; nothing is invented). A year gets an anomaly only if the period covers the whole year and at least 95% of its days are valid; other years report their mean but no anomaly. Missing days are excluded, never counted as zero. Temperatures are rounded to 2 decimals.
- **Comparison:** the UI calls the two existing endpoints once per location, two locations at a time (no batch endpoint was needed), with one shared period and method. Each location and each request has its own loading and error state and can be retried alone. Presets: Delhi, Mumbai, Bengaluru, Chennai; custom coordinates are validated and duplicates are refused. Averages state their denominator (complete years); "No events", "No complete year" and "Failed to load" are shown instead of zeros.
- Heatwave counts and anomalies are relative to each location's own threshold and baseline; only the mean daily maximum is an absolute temperature.
- Details, formulas and boundaries: [docs/temperature_anomaly_design.md](docs/temperature_anomaly_design.md) and [backend/README.md](backend/README.md).

Example request: `curl "http://localhost:8000/api/temperature-anomalies?latitude=19.0760&longitude=72.8777&start_date=2010-01-01&end_date=2025-12-31"`.

## Geospatial explorer (Phase 10)

- **Pages:** Global Climate Explorer (world map; select or search a country), India Climate Explorer (all 36 states and union territories; summary cards, a chart of analysed locations, annual trends, a data-availability table) and State Comparison (2 to 4 states; summary cards, line charts, grouped bar chart of event statistics, annual trends, coverage, CSV download).
- **What the numbers mean:** the APIs analyse one grid cell. So the maps show **observation locations**: one per Indian state/UT (the capital where it lies inside the territory, otherwise a major city: Punjab uses Ludhiana and Haryana uses Hisar, because Chandigarh is a separate UT), plus 27 locations in 26 other countries. Area colours show only data availability. Climate values appear on point markers and in panels labelled, for example, "Capital-city observation point, not a state-wide average". No country or state aggregate is computed anywhere. Countries without a location say so. The temperature trend is listed as unavailable because no endpoint computes it.
- **No mass ingestion:** opening a page loads the static catalog and one coverage read. Analyses run only when you press Analyse or Compare (at most two locations at a time). A session cache shares results between pages. Countries with more than four locations offer no "analyse all".
- **Boundaries:** Natural Earth 1:10m countries, India point of view (public domain), and geoBoundaries IND ADM1 (CC BY 2.5 IN, from DataMeet and the Election Commission of India) with current ISO 3166-2:IN codes. Both are simplified by `npm run build:geo` (pinned sources with SHA-256, pinned mapshaper). Rendering uses d3-geo, d3-zoom and topojson-client as React SVG, with no tile service or API key.
- Design, data sources, licences, CRS, update process and the future state-aggregation method: [docs/geospatial_architecture.md](docs/geospatial_architecture.md).

## Historical-weather cache and performance (Phase 9.1)

- **Authoritative cache:** for a normal read, a complete requested range in `weather_records` is authoritative. The service performs one indexed MongoDB range read for an already-complete warm range rather than reading each yearly chunk and its ingestion-cache metadata separately.
- **TTL behaviour:** `ingestion_cache` remains TTL metadata for ingestion. Its expiry does **not** cause an otherwise complete historical range to be refreshed from Open-Meteo. Explicit refresh or invalidation is a future enhancement.
- **Data revisions:** historical/reanalysis data, especially recent weeks, can be revised by Open-Meteo. Stored records therefore represent the values fetched at ingestion time until an explicit refresh capability exists.
- **Verified isolated benchmark:** Phase 9.1 measured the optimized warm path as 31% faster for heatwave analysis, 21% faster for anomaly analysis, 45% faster for a two-city comparison, and 47% faster for a four-city comparison. These are controlled benchmark improvements, not production service-level measurements. Cold requests still require upstream ingestion; see [backend performance notes](backend/README.md#performance-phase-91).

## Statistical assumptions

Trends are ordinary least squares of each annual metric on the calendar year (`scipy.stats.linregress`), with a two-sided t-test on the slope (significance level 0.05). Only complete years are used; zero-event years count as 0 for frequency and heatwave days, but are treated as **missing** (not zero) for mean duration and intensity. Assumptions that are only approximately true and are **not tested**: linearity, independent errors with constant variance, roughly normal residuals. Serial correlation is not modelled (p-values may be too small), the five metrics are not corrected for multiple comparisons, and fewer than 10 years triggers a low-power note (fewer than 3 gives no result). A significant trend is an association in one grid cell over the chosen window, not evidence of cause, and not a forecast.

## Testing

```
# backend (from backend/; needs a reachable MongoDB; integration tests use a throwaway database and mocked Open-Meteo)
venv\Scripts\python -m pytest

# frontend (from frontend/)
npm run lint
npm run typecheck
npm test
npm run build

# real-browser check at 360/768/1280/1680 px plus an axe accessibility audit
# (needs Edge or Chrome, the backend running with MongoDB, and internet access; it triggers real Open-Meteo requests)
npm run build
npx vite preview --port 5173 --strictPort      # in a second terminal
npm run check:browser

# real-browser check of the map pages (360/768/1280/1680 px, light and dark, axe incl. contrast); starts no analysis
npm run check:maps
```

No test needs production credentials. Backend tests need only a local MongoDB. `backend/tests/conftest.py` pins `MONGODB_URI` to `TEST_MONGODB_URI` (default `mongodb://localhost:27017`) before the app reads its settings, and refuses a non-local URI unless `ALLOW_REMOTE_TEST_DB=1`. **DANGEROUS:** it lets the integration fixtures create and drop `test_*` databases on that server, so use it only with a dedicated, disposable test deployment (never the production Atlas cluster), and never with a URI naming `climate_hazard_db` (refused). Before Phase 10, a plain `pytest` run used the URI in `backend/.env`, which could be Atlas. Frontend tests are fully mocked or fixture-based.

## Deployment

Not performed yet. Per-platform settings and variables (Render, Atlas, Vercel) are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). What a deployment needs, based on how the code is built:

1. **MongoDB Atlas** (or any MongoDB): create a database user, allow the backend host's IP in Atlas network access, and put the `mongodb+srv://` string in the backend host's secret store as `MONGODB_URI`. Indexes (including unique ones) are created automatically at startup. Verified against a real Atlas cluster from a local backend (startup, indexes, `/health/db`, a real heatwave analysis, 12,053 stored records); not yet verified from a hosted backend.
2. **Backend** on any host that runs a long-lived Python 3.11 process:
   - install: `pip install -r requirements.txt`; start (from `backend/`): `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - set `MONGODB_URI`, `CORS_ALLOWED_ORIGINS=<frontend origin>`, and `TRUST_PROXY_HEADERS=true` only if the platform's proxy sets `X-Forwarded-For`.
   - run a **single worker**: the rate limiter is per process (N workers multiply the limit by N). Use `/health` for liveness and `/health/db` for readiness.
    - **Request time:** a cold request loads about 31 yearly chunks and up to 120 for a 90-year window. Its latency remains upstream-dependent and was not re-benchmarked in Phase 9.1; the platform timeout must accommodate it (the browser gives up at 90 s). Warm performance improved in isolated Phase 9.1 benchmarks through indexed range reads (see [backend performance notes](backend/README.md#performance-phase-91)). Hosted-production latency and capacity have not been measured, so verify platform timeouts and end-to-end timing before launch.
3. **Frontend**: `cd frontend && VITE_API_BASE_URL=<backend URL> npm run build`, then serve `frontend/dist/` from any static host. Production builds fail if `VITE_API_BASE_URL` is missing or invalid (and, on Vercel, if it is localhost or not https), so a bundle cannot silently call `localhost`. It is a single-page app with client-side routes: the host must serve `index.html` for unknown paths (`frontend/vercel.json` does this on Vercel).
4. Set `CORS_ALLOWED_ORIGINS` on the backend to the exact frontend origin, then check `/health/db` and run one analysis end to end.

## Known limitations

- Single grid cell per location, daily maximum only (no humidity or night-time heat), UTC days, one all-season threshold. See [backend/README.md](backend/README.md) for the full list.
- Years inside the baseline are measured against a threshold they helped set (flagged with `analysis_overlaps_baseline`).
- Historical/reanalysis datasets can be revised upstream, especially for recent weeks. Complete stored ranges remain authoritative after ingestion-cache TTL expiry; they are not refreshed automatically. Explicit refresh/invalidation is not implemented yet.
- The rate limiter is in memory and per process; there is no authentication.
- Cold requests depend on Open-Meteo availability and its usage terms. The upstream cap remains 4 concurrent fetches, so cold comparisons of new locations can be slow.
- Phase 9.1 isolated benchmarks found 31%/21% faster warm heatwave/anomaly analyses and 45%/47% faster two-/four-city comparisons. These figures are not production measurements; hosted behaviour, sustained load and capacity remain unverified.
- Two locations whose coordinates differ but fall in the same Open-Meteo grid cell (about 10 km) give identical data; only identical coordinates (to 4 decimals) are refused.
- Not verified: behaviour from a hosted backend (Atlas itself was verified from a local one), sustained load from many clients, any hosted environment.
- The colour theme follows the operating system unless changed with the header toggle; the choice is kept in this browser only.
- Map values are location-level only: no country-wide or state-wide aggregation exists yet (design in [docs/geospatial_architecture.md](docs/geospatial_architecture.md)). Boundaries are for navigation, generalised (world coastlines by up to ~20 km, islands under 150 km² omitted; India ~1 km), and imply no position on disputed territory.

## AI assistance disclosure

This project was built with substantial assistance from AI coding tools (including Claude Code and OpenAI Codex), which wrote and reviewed much of the code, tests and documentation, including this README. The design, requirements and acceptance decisions were directed and reviewed by the project owner. Statistical and climate conclusions from the app should be independently verified before being relied on.
