# Climate Hazard Trend Analyzer: frontend

React 19 + Vite + TypeScript dashboard for the FastAPI backend (`GET /api/heatwaves`). Tailwind CSS v4, shadcn/ui-style components (Radix primitives, `components.json` included), Recharts, Lucide icons. No state-management library: the `useHeatwaveAnalysis` hook owns the request lifecycle.

## Run

```
cp .env.example .env.local     # VITE_API_BASE_URL, default http://localhost:8000
npm install
npm run dev                    # http://localhost:5173 (the backend's default CORS origin)
```

The backend must allow the frontend's origin (`CORS_ALLOWED_ORIGINS`) and be running with MongoDB. Its `Retry-After` header is already exposed to browsers.

## Scripts

| Script | What it does |
|---|---|
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest + Testing Library (jsdom) |
| `npm run build` | typecheck + production build |
| `node scripts/browser-check.mjs <dir>` | Real-browser check of the built app against a running backend: 4 viewport widths, no sideways scroll, charts fit, touch-target size, console errors, axe accessibility audit (light and dark). Needs Edge or Chrome and `npx vite preview --port 5173`. |

## Layout

- `src/lib/api/`: `types.ts` (mirrors the backend Pydantic schemas), `parse.ts` (runtime validation of every response), `client.ts` (fetch, timeout, error mapping), `errors.ts` (error body `{"detail": {"error", "errors"?}}`, `Retry-After`, user-facing copy).
- `src/lib/validation.ts`: form rules that mirror the backend (lat/lon bounds, archive 1940-01-01 to today − 5 days, at most 90 calendar years, rolling window 2 to 30).
- `src/lib/chartData.ts`: turns `annual[]` and `trend.metrics[].rolling_average` into chart rows, classifying each year as complete, incomplete, no events (undefined, not zero) or no data.
- `src/components/`: one file per dashboard section. `ui/` holds the shadcn-style primitives.
- `src/test/fixtures/live-sample.json` is a real response captured from the backend; `fixtures.ts` builds synthetic ones for UI tests (not weather data).

## Behaviour worth knowing

- Cold analyses take 5 to 15 s against a local MongoDB and about 42 s against Atlas (warm: 1 to 1.4 s): the loading state shows staged status text, an elapsed timer, a skeleton and Cancel. The client gives up after 90 s.
- 429 and 503 honour `Retry-After` (clamped to 120 s): the Analyze button and the error panel count down.
- Incomplete years are drawn hatched and left out of trends. Years with no events have no bar for mean duration and intensity, because those values are undefined, not zero.
- Dark mode follows the operating system. Motion (bar growth, shimmer, spinners, smooth scroll) is switched off under `prefers-reduced-motion`.
