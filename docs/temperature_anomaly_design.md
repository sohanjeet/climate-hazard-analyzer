# Phase 9: temperature anomalies and multi-location comparison

Design note for `GET /api/temperature-anomalies` (method `temperature-anomaly-v1`) and the comparison view. The heatwave method (`heatwave-v1`), its 95th-percentile threshold, `GET /api/heatwaves` and its response are unchanged.

## 1. Temperature anomaly

### Definition

For each analysis year *y*:

```
annual_mean_daily_max_c(y) = mean of the valid daily maximum temperatures (°C) of year y inside the requested window
baseline_mean_daily_max_c  = mean of all valid daily maximum temperatures from baseline_start_year-01-01 to baseline_end_year-12-31
temperature_anomaly_c(y)   = annual_mean_daily_max_c(y) - baseline_mean_daily_max_c
```

Example: annual mean 32.4 °C, baseline mean 30.8 °C, anomaly +1.6 °C.

- The baseline is the same fixed period as the heatwave analysis (default **1991 to 2020**, `HEATWAVE_BASELINE_START_YEAR` / `_END_YEAR`, optional `baseline_start_year` / `baseline_end_year` query parameters with the same validation). It is never substituted silently: the response always states it.
- The baseline mean weights every valid day equally (leap days included). It is the mean of daily values, not the mean of 30 annual means; the two differ slightly when years have different numbers of valid days.
- This is **annual mean daily maximum**, not the absolute annual maximum, not the mean air temperature (which includes nights) and not a heatwave threshold. The heatwave threshold is the 95th percentile of the same baseline; the anomaly baseline is its mean. They are independent quantities.
- Anomalies describe past years. Nothing is extrapolated and nothing is a forecast.

### Data and completeness rules

Daily data comes from the existing `weather_records` collection through `HeatwaveService.load_series` (same year chunks, same ingestion cache keys, same keyed locks, same upstream semaphore), so a location already analysed for heatwaves costs no new upstream request. Valid means present and finite; `null`, out-of-range and non-finite values were already excluded at ingestion. Missing days are excluded, never filled in and never counted as zero.

| Quantity | Rule | Source of the convention |
|---|---|---|
| Baseline | at least **90%** of baseline days valid, otherwise `422 baseline period has insufficient valid observations` (no result is fabricated) | `HEATWAVE_BASELINE_MIN_COVERAGE` |
| Baseline year | under 90% valid adds `baseline_year_low_coverage:<YYYY>` | same |
| Analysis year | **complete** when the window covers the whole calendar year and at least **95%** of its days are valid | `HEATWAVE_YEAR_MIN_COVERAGE` |

Per-year `status`:

| status | Meaning | `annual_mean_daily_max_c` | `anomaly_c` |
|---|---|---|---|
| `complete` | whole year requested, coverage at least 95% | value | value |
| `low_coverage` | whole year requested, coverage under 95% | value | `null` |
| `partial_year` | the window covers only part of the year | value | `null` |
| `no_data` | no valid observation | `null` | `null` |

An anomaly is withheld unless the year is complete: the mean of a part of a year (for example March to December) is seasonally different from the whole-year baseline, so comparing them would be misleading. The mean is still reported so it can be inspected. All thresholds were tested at their boundaries (3,287 / 3,286 of 3,652 baseline days; 347 / 346 of 365 year days).

`years_without_anomaly:<n>`, `analysis_missing_days:<n>` and `analysis_overlaps_baseline` are added to `data_quality.warnings` when they apply. Years inside the baseline are compared with an average they helped set, which pulls their anomalies toward zero.

### Rounding

All arithmetic is full precision. Returned temperatures are rounded to **2 decimals** and coverage fractions to **4**. The anomaly is computed from the unrounded means and then rounded, so it can differ by 0.01 °C from the difference of the two rounded means. Negative zero is normalised to `0.0`. The decimals are echoed in `method.temperature_decimals` and `method.coverage_decimals`.

### Endpoint

`GET /api/temperature-anomalies?latitude&longitude&start_date&end_date[&baseline_start_year&baseline_end_year]`

Validation, error bodies and status codes are those of `/api/heatwaves` (the same `HeatwaveService.validate_request`): `422` invalid input or insufficient baseline, `429` rate limited, `502`/`503`/`504` upstream or database problems. There is no `rolling_window_years`. Response (`TemperatureAnomalyResponse`, documented in `/docs`): `location_key`, `latitude`, `longitude`, `start_date`, `end_date`, `method`, `baseline` (`start_year`, `end_year`, `mean_daily_max_c`, `observation_count`, `expected_count`, `coverage`, `low_coverage_years`), `annual[]` (`year`, `annual_mean_daily_max_c`, `anomaly_c`, `observation_count`, `expected_count`, `coverage`, `status`, `warnings`), `summary`, `data_quality`, `source`, `computed_at`.

`summary` denominators: `complete_years` is the denominator of `mean_anomaly_c` and `mean_annual_daily_max_c`; both are `null` with no complete year. `positive_years` + `negative_years` + `zero_years` = `complete_years`. Ties for warmest/coolest year go to the earliest year.

### Persistence and caching

Nothing new is persisted: no collection, index or migration. Results are derived on every call from stored daily records, which are reused through the existing ingestion cache. Because anomalies read the same cache keys as heatwaves, running one warms the other, identical simultaneous requests share one upstream fetch (per-chunk keyed locks), and the part of the analysis window that overlaps the baseline is sliced from the baseline load instead of being loaded again. If a later phase wants stored results, the deterministic key would be (`location_key`, `temperature_anomaly`, `start_date`, `end_date`, a hash of `method_version` + baseline years + coverage settings), following `analysis_results`.

### Rate limiting

`/api/temperature-anomalies` can trigger the same cold ingestion as `/api/heatwaves`, so it gets the stricter limit (`RATE_LIMIT_HEATWAVE_REQUESTS_PER_MINUTE`, default 20) in **its own bucket**. Heatwave quotas are unaffected. A comparison of *n* locations makes *n* calls to each endpoint.

## 2. Multi-location comparison

### Why no batch endpoint

Repository inspection showed that `GET /api/heatwaves` already returns everything the comparison needs per location (totals, durations, heatwave days per complete year, the heatwave-day trend, coverage), and the only missing quantity, annual mean daily maximum, is exactly what the new endpoint adds. A batch endpoint would have needed its own concurrency control on top of the existing upstream semaphore, partial-failure semantics and rate-limit accounting, with no new data. The frontend therefore calls the two existing endpoints per location.

### Concurrency and failure handling

- 2 to 4 locations; the same period and the same method for every location.
- Locations run **two at a time** (`COMPARISON_CONCURRENCY`); each location makes its heatwave and anomaly calls together, so at most 4 backend requests are in flight. The backend still caps simultaneous Open-Meteo requests at `WEATHER_FETCH_CONCURRENCY` (4) and serialises identical chunk ingests, so the comparison adds no upstream concurrency.
- Every location and each of its two requests has its own loading / success / error state. One failure never hides the others. Failed requests can be retried alone (per location, or all failed). A new run, Cancel or leaving the page aborts everything in flight.
- Duplicate locations are rejected by coordinates rounded to 4 decimals (about 11 m). Distinct coordinates inside the same Open-Meteo grid cell (roughly 10 km) give identical data; the UI does not check for that.

### Metrics (all read from the API responses, no new arithmetic)

| Metric | Source | Denominator |
|---|---|---|
| Total events, total heatwave days | `summary.total_events`, `summary.total_heatwave_days` | whole period |
| Mean / longest event duration | `summary.mean_duration_days`, `max_duration_days` | events; "No events" when there are none (never 0 or NaN) |
| Heatwave days per year | `summary.heatwave_days_per_complete_year` | complete years (shown as *n*) |
| Heatwave-day trend | `trend.metrics[total_heatwave_days]`, slope per decade and classification | complete years |
| Mean daily maximum | `summary.mean_annual_daily_max_c` | complete years (shown as *n*) |
| Mean anomaly | `summary.mean_anomaly_c` | complete years |
| Coverage | `data_quality` | days in the period |

Missing versus zero: a value that failed to load shows "Failed to load" or "Loading…", an undefined value shows its reason ("No events", "No complete year"), and a genuine zero shows 0. In the charts a complete year with no heatwave days is plotted at 0; incomplete years and years without observations are gaps, with the reason in the tooltip and the data table.

### Charts

Three line charts (heatwave days, annual mean daily maximum, anomaly), Recharts only. Series colours are categorical slots 1 to 4 of the validated palette, checked for colour-vision separation and contrast in light and dark mode; each location also has its own marker shape and line dash, so colour is never the only cue. A colour slot belongs to the location, so removing one city does not repaint the others.
