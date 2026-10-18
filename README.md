# Climate Hazard Trend Analyzer

A web dashboard that shows how often, how long and how intense heatwaves were at any place on Earth, and whether those numbers are trending up or down over a chosen period. You pick a latitude/longitude and a date window; the backend pulls historical daily maximum temperatures, detects heatwaves against a fixed local threshold, and fits statistical trends.

> **Status:** development is complete and tested locally. Nothing has been deployed and there is no public URL yet. See [Deployment](#deployment) and [Known limitations](#known-limitations).

## Architecture

```
Browser (React SPA)  --GET /api/heatwaves-->  FastAPI  --GET-->  Open-Meteo archive API
                                                 |
                                                 +--> MongoDB (weather_records, ingestion_cache, analysis_results)
```

- **Frontend** (`frontend/`): static single-page app. Calls only `GET /api/heatwaves`, validates every response at runtime, and renders summary metrics, four charts, trend insights, data-quality notes and a methodology section.
- **Backend** (`backend/`): FastAPI service. Loads the baseline (default 1991 to 2020) and the analysis window one calendar year at a time, stores daily records in MongoDB so repeat requests are served from the database, then computes heatwave events, annual metrics and trends.
- **Data source:** [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), variable `temperature_2m_max`, UTC days.
- `docs/phase4a_heatwave_design.md` is the original design note for the heatwave method.

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
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS_PER_MINUTE`, `RATE_LIMIT_HEATWAVE_REQUESTS_PER_MINUTE` | `true`, `60`, `20` | Per client IP, in process memory. |
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
| `GET /api/weather?latitude&longitude&start_date&end_date` | Ingest and return daily records (max 366 days). Rate limit 60/min per IP by default. |
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
```

No test needs production credentials. Backend tests need only a local MongoDB; frontend tests are fully mocked or fixture-based.

## Deployment

Not performed yet. Per-platform settings and variables (Render, Atlas, Vercel) are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). What a deployment needs, based on how the code is built:

1. **MongoDB Atlas** (or any MongoDB): create a database user, allow the backend host's IP in Atlas network access, and put the `mongodb+srv://` string in the backend host's secret store as `MONGODB_URI`. Indexes (including unique ones) are created automatically at startup. Atlas compatibility has not been tested against a real Atlas cluster.
2. **Backend** on any host that runs a long-lived Python 3.11 process:
   - install: `pip install -r requirements.txt`; start (from `backend/`): `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - set `MONGODB_URI`, `CORS_ALLOWED_ORIGINS=<frontend origin>`, and `TRUST_PROXY_HEADERS=true` only if the platform's proxy sets `X-Forwarded-For`.
   - run a **single worker**: the rate limiter is per process (N workers multiply the limit by N). Use `/health` for liveness and `/health/db` for readiness.
   - **Request time:** a cold request loads about 31 yearly chunks (about 5 to 15 s measured locally) and up to 120 for a 90-year window. The platform's HTTP timeout must exceed this (the browser gives up at 90 s); platforms with a 30 s limit will cut off long windows on cold locations. Repeat requests take about 0.2 to 0.4 s locally.
3. **Frontend**: `cd frontend && VITE_API_BASE_URL=<backend URL> npm run build`, then serve `frontend/dist/` from any static host. Production builds fail if `VITE_API_BASE_URL` is missing or invalid (and, on Vercel, if it is localhost or not https), so a bundle cannot silently call `localhost`. It is a single-page app with no client-side routing, so no rewrite rules are needed.
4. Set `CORS_ALLOWED_ORIGINS` on the backend to the exact frontend origin, then check `/health/db` and run one analysis end to end.

## Known limitations

- Single grid cell per location, daily maximum only (no humidity or night-time heat), UTC days, one all-season threshold. See [backend/README.md](backend/README.md) for the full list.
- Years inside the baseline are measured against a threshold they helped set (flagged with `analysis_overlaps_baseline`).
- Most recent weeks of reanalysis data are preliminary; cached records are not refreshed automatically.
- The rate limiter is in memory and per process; there is no authentication.
- Cold requests depend on Open-Meteo availability and its usage terms; they were measured only at concurrency 4 with a local MongoDB.
- Not verified: behaviour against MongoDB Atlas, sustained load from many clients, any hosted environment.
- Dark mode follows the operating system (no manual toggle).

## AI assistance disclosure

This project was built with substantial assistance from AI coding tools (including Claude Code and OpenAI Codex), which wrote and reviewed much of the code, tests and documentation, including this README. The design, requirements and acceptance decisions were directed and reviewed by the project owner. Statistical and climate conclusions from the app should be independently verified before being relied on.
