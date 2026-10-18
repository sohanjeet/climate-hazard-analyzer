# Deployment configuration

Nothing here has been deployed or tested against a hosted environment. Items marked **verify** can only be confirmed on the real platform.

Target layout: MongoDB Atlas (database) <- Render (FastAPI backend) <- Vercel (static frontend).

## Backend (Render web service)

| Setting | Value |
|---|---|
| Root directory | `backend` (the app loads `.env` and imports `app.*` relative to this directory) |
| Runtime | Python 3.11 (versions in `requirements.txt` were tested on 3.11.9; set `PYTHON_VERSION=3.11.9`) |
| Build command | `pip install -r requirements.txt` (`requirements-dev.txt` is for tests only; do not use it in production) |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/health` (liveness, does not touch the database; `/health/db` returns 503 when MongoDB is unreachable) |
| Workers | One. The rate limiter is in memory and per process |

### Environment variables

| Variable | Production value | Notes |
|---|---|---|
| `MONGODB_URI` | Atlas `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority` | **Required, secret.** If unset the app falls back to `mongodb://localhost:27017`, fails its startup ping and exits (it never connects to a local database in production). Mark as a secret in Render |
| `DATABASE_NAME` | e.g. `climate_hazard_db` | Optional (default shown) |
| `CORS_ALLOWED_ORIGINS` | the exact Vercel origin, e.g. `https://<project>.vercel.app` | **Required.** No trailing path. Comma-separate to allow several. Default is localhost only, so the browser blocks every call until this is set |
| `TRUST_PROXY_HEADERS` | `true` | Render's proxy appends the client IP to `X-Forwarded-For`; without this every visitor shares one rate-limit bucket. **Verify** the header is present |
| `PYTHON_VERSION` | `3.11.9` | Render setting, not read by the app |
| `LOG_LEVEL`, `RATE_LIMIT_*`, `WEATHER_FETCH_CONCURRENCY`, `OPEN_METEO_*`, `MONGODB_*_TIMEOUT_MS`, `MONGODB_MAX_POOL_SIZE` | defaults from `backend/.env.example` | Optional tuning. `.env.example` lists them all |

`backend/.env` is never uploaded (git-ignored). On Render set variables in the dashboard.

## Database (MongoDB Atlas)

1. Create a cluster and a database user with read/write on the application database only (not an Atlas admin).
2. Network access: Render's free plan has no fixed outbound IP, so allow `0.0.0.0/0` and rely on the user's strong password, or use a paid plan with static outbound IPs and allow only those.
3. Use the `mongodb+srv://` string. `dnspython` (needed for `+srv`) is installed automatically as a dependency of `pymongo` 4.x.
4. TLS: Atlas requires TLS and PyMongo enables it for `mongodb+srv://` by default, using the platform's CA bundle; no code or option change is needed. **Verify** the connection on first deploy: a TLS or network-access problem shows up as `MongoDB connection failed (<ErrorName>)` in the logs and the service exits at startup. Error messages are deliberately stripped of the connection string.
5. Indexes (including unique and TTL ones) are created idempotently at startup. The database user therefore needs `createIndex`, which the built-in `readWrite` role includes.

## Frontend (Vercel)

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` (runs `tsc -b && vite build`) |
| Output directory | `dist` |

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<service>.onrender.com` | **Required at build time.** Not a secret (it ships in the bundle). Set it before the first build; changing it needs a redeploy |

Production builds fail if `VITE_API_BASE_URL` is missing, blank or not an http(s) URL. On Vercel (`VERCEL` set) they also fail for a localhost or plain-`http://` value. Locally a localhost value only prints a warning, so `npm run build && npm run preview` keeps working. The check lives in `frontend/src/lib/buildEnv.ts` and is wired up in `frontend/vite.config.ts`.

The app is a single-page app with no client-side routing, so no rewrite rules are needed.

## Pre-flight checklist (after deploying)

1. `GET <backend>/health` returns `{"status":"healthy"}` and `GET <backend>/health/db` the same.
2. Open the Vercel URL, run one analysis for the default location (a cold request took 41.65 s against Atlas, 5 to 15 s against a local MongoDB; the platform's request timeout must allow it and the browser gives up at 90 s).
3. The browser console shows no CORS error (if it does, `CORS_ALLOWED_ORIGINS` does not match the Vercel origin exactly).
4. Repeat the analysis and confirm it is fast (served from MongoDB; 1.12 to 1.35 s measured against Atlas from a local backend).
