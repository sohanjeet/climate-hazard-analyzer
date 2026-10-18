# Climate Hazard Trend Analyzer: backend

FastAPI + MongoDB service that ingests Open-Meteo historical daily maximum temperatures and detects heatwaves.

## Endpoints

- `GET /api/weather?latitude&longitude&start_date&end_date`: ingest and return daily records (max 366 days per call).
- `GET /api/heatwaves?latitude&longitude&start_date&end_date[&baseline_start_year&baseline_end_year][&rolling_window_years]`: heatwave events, per-year metrics, summary and a `trend` block (see Trend analysis). `rolling_window_years` is optional (2 to 30, default 5). Clients that ignore `trend` are unaffected.

The first heatwave request at a new location loads the 30-year baseline one calendar year at a time: about 30 Open-Meteo calls, at most 4 in flight at once (`WEATHER_FETCH_CONCURRENCY`). Measured cold latency is in [Performance](#performance-phase-6); later requests read from MongoDB. Clients should show a loading state.

Operational endpoints: `GET /health` (liveness) and `GET /health/db` (readiness; `503 {"status": "unavailable"}` when MongoDB cannot be reached).

Every call recomputes the analysis and upserts the result into `analysis_results` as a record of past runs. Saved results are not used as a cache.

## Tests

```
venv\Scripts\python -m pytest
```

Tests marked `integration` need a reachable MongoDB (they use a throwaway database; Open-Meteo is mocked).

### Heatwave detection: method and assumptions (`heatwave-v1`)

- **Definition:** a heatwave is ≥ 3 consecutive calendar days on which the daily maximum 2 m temperature is **strictly above** the location's 95th-percentile threshold.
- **Region:** the single Open-Meteo grid cell nearest to the requested coordinates. This is a reanalysis grid cell, not a station and not an area average.
- **Threshold:** one annual (all-season) 95th percentile of daily maximum temperature over a fixed baseline (default 1991–2020), using linear interpolation (`numpy.percentile` default). The same threshold is applied to every analysis year, so years can be compared directly.
- **Missing data:** missing days are never filled in. A missing day ends a run of hot days, so the counts may be **underestimates** where data are missing. Events next to missing data are flagged.
- **Calendar:** days are UTC calendar days (Open-Meteo `timezone=UTC`). Leap days are handled with ordinary date arithmetic. Feb 29 is part of the baseline, and leap years expect 366 days.
- **Year attribution:** an event belongs to the calendar year in which it starts, even if it continues into the next year.
- **Intensity:** reported as °C above the threshold. Mean intensity is weighted by days. The absolute peak temperature is reported separately.
- **Incomplete years:** a year is complete only if it lies wholly inside the requested window and has ≥ 95% valid days. Incomplete years are shown but left out of per-year rates and of trend analysis.
- **Baseline quality:** the baseline needs ≥ 90% valid days overall and at least 10 calendar years. Individual baseline years under 90% add the warning `baseline_year_low_coverage:<YYYY>`.

**Known limitations and biases**

1. **Baseline years used as analysis years:** years inside the baseline are measured against a threshold they helped set. By construction about 5% of baseline days exceed it, which slightly distorts comparisons between baseline and later years. Such requests carry the warning `analysis_overlaps_baseline`.
2. **Annual threshold:** events happen only in the hot season. "Unusually warm for the season" events (e.g. in winter) are not detected by design.
3. **Resolution and ties:** values are reported to 0.1 °C and the comparison is strict, so fewer than 5% of days may exceed the threshold.
4. **Daily maximum only:** humidity and night-time temperatures are ignored, so health-relevant heat stress may be underestimated.
5. **Grid-cell smoothing:** reanalysis cells can underestimate local extremes, urban heat islands and effects of elevation differences.
6. **UTC days:** at locations far from UTC, the "day" is shifted against local time, and one hot afternoon can affect two neighbouring UTC days. This is applied the same way to baseline and analysis data, so the threshold stays internally consistent.
7. **Data revisions:** the most recent weeks of reanalysis data are preliminary and may be revised. Cached records are not refreshed automatically.
8. **Southern Hemisphere:** summers span two calendar years, so calendar-year statistics split a season between two years. Events stay whole but are attributed to their start year.
9. **Small numbers:** annual event counts are small integers and noisy; see the trend limitations below.
10. **Rising frequency is the signal:** against a fixed baseline in a warming climate, recent years are expected to show more events. That is the signal being measured, not an error.

## Trend analysis (`trend-v1`)

Every `/api/heatwaves` response carries a `trend` object (also stored in `analysis_results`). It is computed from the `annual` rows of the same response; the heatwave algorithm itself is unchanged.

### Method

- **Metrics:** `heatwave_frequency` (events per year), `total_heatwave_days`, `mean_duration_days`, `max_intensity_c`, `mean_intensity_c` (°C above the threshold; maximum and mean as defined in `heatwave-v1`).
- **Years used:** only years with `is_complete=true`. Incomplete years are listed in `excluded_incomplete_years` and never enter a regression or a rolling mean.
- **Regression:** ordinary least squares of the metric on the calendar year (`scipy.stats.linregress`). The real year is the x value, so irregular spacing (years dropped for incompleteness or missing values) is handled correctly and flagged with `irregular_spacing`.
- **Reported:** `slope_per_year`, `slope_per_decade` (= 10 × slope), `intercept`, `r_squared`, `p_value`, `std_err`, `n_observations`, `first_year`, `last_year`, `years_used`. The intercept is the fitted value at calendar year 0, a mathematical constant of the line and not a physical estimate.
- **P-value:** two-sided t-test of the null hypothesis "slope = 0", with n − 2 degrees of freedom, as returned by `linregress`. It is reported (`p_value_supported=true`) only when there are at least 3 observations and the series is not constant; otherwise `p_value` is `null`.
- **Classification:** `increasing` or `decreasing` when p < 0.05 (setting `TREND_SIGNIFICANCE_LEVEL`) with the matching slope sign; `no_significant_trend` otherwise (also for a constant series); `insufficient_data` with fewer than 3 usable observations. Fewer than 10 observations adds the note `low_statistical_power`.
- **Insights:** `insights` holds one deterministic plain-language statement per metric. Wording is deliberately cautious: it describes an association within the series and never states a cause.

### Missing data, zeros and gaps

- **Zero is a value.** Zero-event years are kept for `heatwave_frequency` and `total_heatwave_days` (count in `zero_value_observations`).
- **Undefined is missing.** Mean duration and both intensity metrics have no value in a year without events. Those years are listed in `missing_value_years`, left out of that metric's regression, and never replaced by zero or interpolated. These three trends are therefore conditional on a heatwave occurring (note `event_years_only`), and the number of event years behind them can be small.
- **Constant series** (for example no events in any year): slope 0, `r_squared` and `p_value` `null`, classification `no_significant_trend`, note `constant_series`.

### Rolling average

- Trailing mean over `rolling_window_years` consecutive calendar years ending at each year (default 5; setting `TREND_ROLLING_WINDOW_YEARS`, or the `rolling_window_years` query parameter).
- One point per calendar year in the analysis window. A mean is produced only when every year in the window is complete and has a value. Otherwise `rolling_mean` is `null` and `status` says why: `year_unavailable` (the point's own year is excluded or has no value), `gap_in_window` (with the missing years in `gap_years`; gaps are never bridged), or `insufficient_history` (the window starts before the first analysis year, including when the series is shorter than the window).

### Statistical assumptions and limitations

1. OLS assumes a linear trend, independent errors with constant variance and roughly normal residuals. Annual counts are small integers and the intensity metrics are skewed, so the assumptions are only approximate. They are not tested.
2. Serial correlation between years is not modelled. Positive autocorrelation makes p-values too small (trends look more significant than they are).
3. Five metrics are tested per request and p-values are not adjusted for multiple comparisons. The metrics are also strongly related to each other, so they are not five independent confirmations.
4. With few years (3 to 9) the test has little power and the estimates are unstable. A "no significant trend" result does not mean there is no change. A perfect fit through only 3 points can still reach significance, hence the `low_statistical_power` note.
5. A significant trend is a statistical association in one reanalysis grid cell over the chosen window. It is not proof of climate-change causation, and it is sensitive to the window chosen, to natural variability (for example ENSO) and to data revisions.
6. If the analysis window overlaps the baseline, baseline years are measured against a threshold they helped set, which flattens the trend. The trend then carries the warning `analysis_overlaps_baseline`.
7. The linear slope is not extrapolated; nothing here is a forecast.

### Storage

The trend is saved inside the same `analysis_results` document. Its key is unchanged (`location_key`, `analysis_type`, `start_date`, `end_date`, `params_hash`), so a rerun with a different `rolling_window_years` overwrites the earlier trend in that document.

## Production hardening (Phase 6)

None of this changes the heatwave or trend methods, the stored data, or the shape of successful responses.

### Configuration

All values are environment variables (or `.env`); `.env.example` lists them with defaults.

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins. Set the deployed frontend origin. `*` is accepted but logs a warning. |
| `RATE_LIMIT_ENABLED` | `true` | Per-client-IP sliding window on `/api/*` |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | `60` | Limit for `/api/weather` |
| `RATE_LIMIT_HEATWAVE_REQUESTS_PER_MINUTE` | `20` | Separate, stricter bucket for `/api/heatwaves` (each cold request can cost about 31 upstream calls) |
| `TRUST_PROXY_HEADERS` | `false` | Use the last `X-Forwarded-For` entry as the client. Enable only behind your own proxy; otherwise the header is spoofable. |
| `WEATHER_FETCH_CONCURRENCY` | `4` (1 to 8) | Process-wide cap on simultaneous Open-Meteo requests. `1` = fully sequential. |
| `OPEN_METEO_TIMEOUT_SECONDS` / `OPEN_METEO_MAX_RETRIES` | `10` / `2` | Read timeout per attempt (connect timeout 5 s); retries for transient failures |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS`, `_CONNECT_TIMEOUT_MS`, `_SOCKET_TIMEOUT_MS`, `_WAIT_QUEUE_TIMEOUT_MS` | 5000 / 5000 / 30000 / 5000 | Bounds on every database wait |
| `LOG_LEVEL` | `INFO` | |

### Security

- **No authentication**: the API is public and read-only (GET only). Rate limiting and input validation are the protection.
- **CORS** allows only the configured origins, only `GET`, no credentials.
- **Rate limit**: in-memory, per process. With N worker processes the effective limit is N times higher. Over the limit: `429`, `Retry-After`, and the standard error body. `/health*`, `/docs` and `/openapi.json` are not limited.
- **Validation**: coordinates, dates, baseline years and rolling window are bounded at the edge (NaN and infinity are rejected); date range, archive bounds and baseline rules are enforced by the services. The rejected input is never echoed back.
- **Errors** always look like `{"detail": {"error": "<message>"}}`. Validation errors add `"errors": [{"field", "message"}]`. Unhandled exceptions give a generic 500; driver and exception messages are never returned.
  - **Changed in Phase 6:** FastAPI's default 422 body (`detail` as a list of objects that echoed the input) is replaced by the shape above. The `detail` key and the 422 status are unchanged.
- **Secrets**: `MONGODB_URI` is a `SecretStr`; connection failures are re-raised without the driver message; logs record exception *types* only.
- **Headers**: `X-Content-Type-Options: nosniff` and an `X-Request-ID` on every response.

### Reliability

- **Open-Meteo calls** use one pooled client, a 5 s connect and 10 s read timeout, and up to 2 retries with exponential backoff (0.5 s, 1 s, capped at 8 s, plus up to 25% jitter). Retried: timeouts, network errors, HTTP 429/500/502/503/504. Not retried: other 4xx, malformed JSON, invalid payload structure. A `Retry-After` longer than the 8 s cap fails fast. Worst case for one chunk is about 33 s.
- **Status mapping**: timeout 504; upstream rate limit 503; other upstream failures 502.
- **MongoDB outages** after startup return `503 {"detail": {"error": "Database temporarily unavailable"}}` with `Retry-After: 5`; pymongo reconnects by itself. **Startup fails fast** if MongoDB is unreachable (the orchestrator restarts the process).
- **Saving `analysis_results` is best effort.** It is a record of past runs and is never read back, so a failed write is logged and the computed analysis is still returned.
- **Shutdown** closes the HTTP client and the MongoDB client.

### Performance (Phase 6)

- Yearly chunks are fetched by a bounded thread pool (`WEATHER_FETCH_CONCURRENCY`), and a process-wide semaphore keeps the total in-flight Open-Meteo requests at that number however many API requests arrive. Results are merged in chunk order, so output is identical to sequential loading (tested, including a day with a null value).
- Chunks cover disjoint dates, so concurrent upserts never touch the same document. Identical in-flight ingests (same location and range) are serialised: the second caller waits and then reads the first caller's data instead of fetching again.
- If a chunk fails, chunks that have not started are cancelled so a failing upstream is not hammered.
- Repeat requests read from MongoDB only; days Open-Meteo returned as null are retried upstream (one single-day request), as before.
- Indexes were reviewed. Every hot query is served by an index (checked with `explain()` in the tests). Added a unique index `uniq_analysis_key` on `analysis_results` (see Persistence).

**Measured first-load latency** (`scripts/benchmark_live.py`, real Open-Meteo archive, local MongoDB 7, one analysis year plus the default 1991 to 2020 baseline = 31 upstream requests, run on 2026-10-14):

| Location | Concurrency | Cold (s) | Warm (s, 3 runs) | Upstream requests cold / warm |
|---|---|---|---|---|
| Delhi | 1 (sequential) | 13.0 | 0.35 to 0.43 | 31 / 0 |
| Delhi | 4 | 7.3 (includes one retried connect timeout) | 0.15 to 0.26 | 31 / 0 |
| London | 4 | 5.3 | 0.20 to 0.33 | 31 / 0 |
| London | 1 (sequential) | 12.7 | 0.36 to 0.60 | 31 / 0 |
| London | 4 | 4.5 | 0.25 to 0.28 | 31 / 0 |

Concurrency 4 cuts the cold time by about 2.4 to 2.8x in the clean runs, not 4x: Open-Meteo answers each request a little slower under parallel load (mean 0.3 to 0.5 s against 0.2 s). In all five runs the stored data matched: the warm result equalled the cold result, and sequential and concurrent runs gave the same threshold and events. A warm request is about 0.2 to 0.4 s, split roughly into 0.2 s of MongoDB reads (about 11,000 documents) and 0.07 s of baseline computation; this was left as is. The sequential rows use the new pooled client and retry logic, so they approximate, rather than exactly reproduce, the pre-Phase-6 code.

Not measured: behaviour under sustained parallel load from many clients, higher concurrency values (5 to 8), a remote MongoDB (Atlas) where each query costs more, and how Open-Meteo's own weighted call limits react to repeated cold runs. 31 requests per cold run should be well inside Open-Meteo's free-tier limits (check their current terms; the limits were not looked up or approached here).

### Persistence of analysis results

The upsert key for `analysis_results` is (`location_key`, `analysis_type`, `start_date`, `end_date`, `params_hash`). `rolling_window_years` is not part of it, so two runs that differ only in window overwrite one document; the last write wins, and each write replaces the whole document at once, so a stored document is never a mix of two runs. This is harmless today because the API always returns the freshly computed result and never reads the stored copy.

Smallest safe fix, implemented: a **unique index on the upsert key**, plus one retry on `DuplicateKeyError`. Before this, two simultaneous first requests could insert two documents for the same key. If an existing database already contains duplicates, the index cannot be built; startup logs a warning and continues. Remove the duplicates and restart to enable it.

Not done, deliberately: adding the window to the key. That would orphan existing documents and is only needed if stored results are ever served as a cache.

### Observability

Logs are single lines of `key=value`:

- `request method=GET path=/api/heatwaves status=200 duration_ms=412.3 request_id=...`
- `upstream_fetch ok attempts=1 days=366 duration_ms=240`
- `upstream_failure category=timeout|network|rate_limited|server_error|client_error|invalid_response status=... attempt=1/3 retryable=true`
- `database_unavailable type=ServerSelectionTimeoutError`, `analysis_result_save_failed error=...`, `unhandled_error type=...`

Query strings, coordinates and URLs are never logged: the request log omits the query, unmatched paths are logged as `unmatched`, the `httpx` logger is held at WARNING (it logs full URLs at INFO), and a filter strips the query string from uvicorn's access log.

### Running and benchmarking

```
venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
venv\Scripts\python -m scripts.benchmark_live --lat 28.6139 --lon 77.2090 --concurrency 1 4
```

The benchmark makes about 31 real Open-Meteo requests per run in a throwaway database that is dropped afterwards.
