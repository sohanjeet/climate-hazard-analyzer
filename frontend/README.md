# Climate Hazard Trend Analyzer: frontend

React 19 + Vite + TypeScript dashboard for the FastAPI backend (`GET /api/heatwaves` and `GET /api/temperature-anomalies`) with two views: **Analyze** (one location) and **Compare** (2 to 4 locations). Tailwind CSS v4, shadcn/ui-style components (Radix primitives, `components.json` included), Recharts, Lucide icons. No state-management library: `useHeatwaveAnalysis` owns the single-location request lifecycle, `useAnomalyAnalysis` the anomaly request next to it, and `useComparison` the per-location state of a comparison.

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
- `src/lib/comparison.ts`: location list rules (2 to 4, duplicate detection at 4 decimals, stable colour slots), custom-coordinate validation, per-location metric extraction and chart series. It only selects values from the API responses; averages keep the backend's denominators (complete years).
- `src/lib/anomalyData.ts`, `src/lib/seriesStyle.ts`: anomaly chart rows (positive/negative split, incomplete years withheld) and the per-location line style (colour, dash, marker).
- `src/hooks/useComparison.ts`: runs the same analysis for the selected locations two at a time; each location and each of its two requests (heatwaves, anomalies) has its own loading/success/error state and can be retried alone. `COMPARISON_CONCURRENCY` is the only knob.
- `src/components/AnomalySection.tsx`: the "Temperature anomalies" section of the Analyze view (anomaly bars with a zero line, annual mean line with the baseline line, statistics, warnings, method). Failure shows its own message and Retry without hiding the heatwave results.
- `src/components/compare/`: location picker, summary cards, side-by-side table, three line charts, coverage notes. The comparison view mounts when first opened and then stays mounted, so switching views keeps its results.
- `src/components/`: one file per dashboard section. `ui/` holds the shadcn-style primitives.
- `src/test/fixtures/live-sample.json` is a real response captured from the backend; `fixtures.ts` builds synthetic ones for UI tests (not weather data).

## Behaviour worth knowing

- Cold analyses need upstream ingestion and can take tens of seconds in the isolated Atlas benchmark: the loading state shows staged status text, an elapsed timer, a skeleton and Cancel. The client gives up after 90 s. Production latency has not been measured.
- 429 and 503 honour `Retry-After` (clamped to 120 s): the Analyze button and the error panel count down.
- Incomplete years are drawn hatched and left out of trends. Years with no events have no bar for mean duration and intensity, because those values are undefined, not zero.
- Anomalies: positive years are solid bars above a zero line, negative years hatched bars below it, and the sign is also spelled out in tooltips and the table, so colour is never the only cue. Incomplete years get no anomaly (no bar, "withheld" in the table); that is never drawn as zero.
- Comparison: a first run for a new location still needs upstream ingestion. Phase 9.1's isolated benchmark improved warm two-city comparisons by 45% and four-city comparisons by 47% through backend range reads; these are not production timing guarantees. Series are told apart by colour, marker shape and line dash; the colours are from a validated palette (`--series-1` to `--series-4` in `index.css`).
- Dark mode follows the operating system. Motion (bar growth, shimmer, spinners, smooth scroll) is switched off under `prefers-reduced-motion`.
