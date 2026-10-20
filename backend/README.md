# Climate Hazard Trend Analyzer: backend

FastAPI + MongoDB service that ingests Open-Meteo historical daily maximum temperatures, detects heatwaves and computes annual temperature anomalies.

## Endpoints

- `GET /api/weather?latitude&longitude&start_date&end_date`: ingest and return daily records (max 366 days per call).
- `GET /api/heatwaves?latitude&longitude&start_date&end_date[&baseline_start_year&baseline_end_year][&rolling_window_years]`: heatwave events, per-year metrics, summary and a `trend` block (see Trend analysis). `rolling_window_years` is optional (2 to 30, default 5). Clients that ignore `trend` are unaffected.
- `GET /api/temperature-anomalies?latitude&longitude&start_date&end_date[&baseline_start_year&baseline_end_year]`: annual mean daily maximum temperature and its anomaly against the fixed baseline (Phase 9, see [Temperature anomalies](#temperature-anomalies-phase-9)).
- `GET /api/geography/locations[?country=IND][&region=IN-RJ]`: the curated observation locations used by the map pages (`app/services/geography_catalog.py`). `scope` is always `observation_location`. `country` must be ISO 3166-1 alpha-3. `region` must be a current ISO 3166-2:IN code (the 36 states and UTs), and only with `IND`. Invalid filters return `422`; a valid country with no location returns an empty list.
- `GET /api/geography/coverage?start_date&end_date[&country][&region]`: for each matching location, stored valid days in the 1991–2020 baseline and in the window, and `status` (`stored`: an analysis needs no download; `partial`; `not_stored`). Same date rules as the analyses. It runs one aggregation on `weather_records` that is covered by the `uniq_location_date` index (hinted, so no document fetch), with `maxTimeMS` 5000. It never calls Open-Meteo, writes nothing, and says nothing about validity.

Both geography endpoints use the general rate-limit bucket (60/min). No endpoint computes a country or state aggregate.

The first heatwave request at a new location loads the 30-year baseline one calendar year at a time: about 30 Open-Meteo calls, at most 4 in flight at once (`WEATHER_FETCH_CONCURRENCY`). Cold-request behaviour is described in [Performance](#performance-phase-6-and-91); later requests read from MongoDB. Clients should show a loading state.

Operational endpoints: `GET /health` (liveness) and `GET /health/db` (readiness; `503 {"status": "unavailable"}` when MongoDB cannot be reached).

Every call recomputes the analysis and upserts the result into `analysis_results` as a record of past runs. Saved results are not used as a cache.

## Tests

```
venv\Scripts\python -m pytest
```

Tests marked `integration` need a reachable MongoDB (they use a throwaway database; Open-Meteo is mocked). `tests/conftest.py` sets `MONGODB_URI` from `TEST_MONGODB_URI` (default `mongodb://localhost:27017`) before the app loads its settings, so the URI in `.env` (possibly Atlas) is never used. A non-local test URI is refused unless `ALLOW_REMOTE_TEST_DB=1`. **DANGEROUS:** it lets the integration fixtures create and drop `test_*` databases on that server, so use it only with a dedicated, disposable test deployment (never the production Atlas cluster), and never with a URI naming `climate_hazard_db` (refused).

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

## Temperature anomalies (Phase 9)

`GET /api/temperature-anomalies` (method `temperature-anomaly-v1`) compares each year's **mean daily maximum temperature** with the **mean daily maximum over the fixed baseline** (default 1991 to 2020):

```
temperature_anomaly_c = annual_mean_daily_max_c - baseline_mean_daily_max_c        e.g. 32.4 - 30.8 = +1.6 °C
```

It is not the mean air temperature, not the absolute annual maximum and not a heatwave threshold (that is the 95th percentile of the same baseline). It describes the past and is not a forecast. The heatwave method and `GET /api/heatwaves` are unchanged. The full definition, thresholds and rounding policy are in [docs/temperature_anomaly_design.md](../docs/temperature_anomaly_design.md).

Example:

```
GET /api/temperature-anomalies?latitude=28.6139&longitude=77.2090&start_date=2010-01-01&end_date=2025-12-31
```

```json
{
  "location_key": "28.613900,77.209000",
  "analysis_type": "temperature_anomaly",
  "method": {"method_version": "temperature-anomaly-v1", "anomaly_formula": "annual_mean_daily_max_c - baseline_mean_daily_max_c", "temperature_decimals": 2, "...": "..."},
  "baseline": {"start_year": 1991, "end_year": 2020, "mean_daily_max_c": 30.66, "observation_count": 10958, "expected_count": 10958, "coverage": 1.0, "low_coverage_years": []},
  "annual": [
    {"year": 2023, "annual_mean_daily_max_c": 30.19, "anomaly_c": -0.47, "observation_count": 365, "expected_count": 365, "coverage": 1.0, "status": "complete", "warnings": []}
  ],
  "summary": {"years_in_window": 16, "complete_years": 16, "mean_anomaly_c": -0.21, "max_anomaly_year": 2010, "positive_years": 5, "negative_years": 11, "...": "..."},
  "data_quality": {"analysis_coverage": 1.0, "missing_day_count": 0, "warnings": ["analysis_overlaps_baseline"]}
}
```

(Abridged. Values are from a real local run against the Open-Meteo archive and were cross-checked against an independent calculation from the stored records.)

- **Parameters and errors** are those of `/api/heatwaves` (no `rolling_window_years`): `422` invalid coordinates, dates or baseline, **or insufficient baseline data** (under 90% valid baseline days; no result is invented), `429`, `502`/`503`/`504`. Error bodies never include internals.
- **Year `status`:** `complete` (whole year requested, at least 95% valid days), `low_coverage`, `partial_year`, `no_data`. Only complete years get `anomaly_c`; the others report their mean (or `null`) but no anomaly. Missing days are excluded, never counted as zero.
- **Data reuse:** daily values come from `weather_records` through the heatwave ingestion path, so a location analysed for heatwaves needs no new upstream request, identical simultaneous requests share one fetch, and the part of the window inside the baseline is not loaded twice. No new collection, index or persisted result.
- **Rate limit:** its own bucket with the `RATE_LIMIT_HEATWAVE_REQUESTS_PER_MINUTE` limit (20/min by default), because a cold request costs as much as a heatwave one.
- **Multi-location comparison needs no batch endpoint:** the frontend calls this endpoint and `/api/heatwaves` once per location (two locations at a time).

Limitations: the baseline mean is a mean of daily values (not of annual means); the same single-grid-cell, UTC-day, reanalysis caveats as the heatwave method apply; years inside the baseline are compared with an average they helped set (`analysis_overlaps_baseline`); an anomaly says nothing about cause. A complete warm range is served by the shared indexed range-read path described in [Performance](#performance-phase-6-and-91).

## Production hardening (Phase 6)

None of this changes the heatwave or trend methods, the stored data, or the shape of successful responses.

### Configuration

All values are environment variables (or `.env`); `.env.example` lists them with defaults.

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins. Set the deployed frontend origin. `*` is accepted but logs a warning. |
| `RATE_LIMIT_ENABLED` | `true` | Per-client-IP sliding window on `/api/*` |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | `60` | Limit for `/api/weather` |
| `RATE_LIMIT_HEATWAVE_REQUESTS_PER_MINUTE` | `20` | Separate, stricter limit for `/api/heatwaves` and, in its own bucket, `/api/temperature-anomalies` (each cold request can cost about 31 upstream calls) |
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

### Performance (Phase 6 and 9.1)

- Yearly chunks are fetched by a bounded thread pool (`WEATHER_FETCH_CONCURRENCY`), and a process-wide semaphore keeps the total in-flight Open-Meteo requests at that number however many API requests arrive. Results are merged in chunk order, so output is identical to sequential loading (tested, including a day with a null value).
- Chunks cover disjoint dates, so concurrent upserts never touch the same document. Identical in-flight ingests (same location and range) are serialised: the second caller waits and then reads the first caller's data instead of fetching again.
- If a chunk fails, chunks that have not started are cancelled so a failing upstream is not hammered.
- Repeat requests read from MongoDB only; days Open-Meteo returned as null are retried upstream (one single-day request), as before.
- Indexes were reviewed. Every hot query is served by an index (checked with `explain()` in the tests). Added a unique index `uniq_analysis_key` on `analysis_results` (see Persistence).

#### Performance (Phase 9.1)

Phase 9.1 changes only the warm data-access path. For a complete requested range, it reads `weather_records` once with the indexed `(location_key, date)` range query instead of issuing a record query and ingestion-cache lookup per yearly chunk. Cold or incomplete ranges retain the existing yearly ingestion path, so scientific calculations and upstream-fetch behaviour are unchanged.

**Verified isolated benchmark results:**

| Warm scenario | Phase 9.1 improvement |
|---|---|
| Single-location heatwave analysis | 31% lower latency |
| Single-location temperature-anomaly analysis | 21% lower latency |
| Two-city comparison | 45% lower latency |
| Four-city comparison | 47% lower latency |

These are controlled, isolated benchmark results for the optimized warm path. They are relative improvements, not public-production latency, throughput, capacity, or SLO measurements.

**Cold performance:** not re-benchmarked for Phase 9.1. A cold or incomplete range still follows the existing yearly Open-Meteo ingestion path, bounded by `WEATHER_FETCH_CONCURRENCY`; the warm-path improvement must not be used to estimate its latency. Production cold performance has not been measured.

#### Historical weather caching policy

`weather_records` is the durable, authoritative cache for normal reads. If every requested date is present, the service returns that complete range even when the related `ingestion_cache` TTL document has expired or been removed. The TTL metadata is still written for ingestion bookkeeping, but it does not trigger automatic refresh of a complete historical range.

Open-Meteo may revise historical/reanalysis data, particularly recent weeks. Consequently, stored values reflect the upstream response at ingestion time until a deliberately requested refresh occurs. There is currently no API or automatic job for cache invalidation or refresh; that is a future enhancement. Missing, null, or invalid dates are not considered complete and continue through the existing re-fetch path.

Not measured: hosted-production behaviour, sustained parallel load from many clients, higher concurrency values (5 to 8), sustained load against a remote MongoDB, and how Open-Meteo's own weighted call limits react to repeated cold runs. 31 requests per cold run should be well inside Open-Meteo's free-tier limits (check their current terms; the limits were not looked up or approached here).

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
