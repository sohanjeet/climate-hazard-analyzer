Written for: Codex as the implementing agent, with you as reviewer.

I read the whole backend first. Four things in the current code shape the design:

- `WeatherService.ingest()` accepts at most 366 days per call (`weather_max_range_days`), so a 30-year baseline has to be loaded one calendar year at a time.
- `ingest()` returns only valid records, so a missing day is simply an absent date, and `missing_dates` lists them.
- The `analysis_results` collection and its `location_type_range` index already exist and are unused.
- `heatwave_service.py`, `schemas/analysis.py` and `routers/analysis.py` exist but are empty.

---

# RECOMMENDED_METHOD

**One fixed 95th-percentile threshold per location, computed from all daily maximum temperatures in a fixed reference period (default 1991–2020). A heatwave is a run of 3 or more consecutive calendar days, each with an observed value strictly above that threshold.**

| Decision                 | Choice                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Threshold type           | One annual (all-season) threshold per location                                                                                  |
| Baseline period          | Fixed: 1991–2020 by default, configurable, at least 10 complete years                                                           |
| Percentile method        | Linear interpolation, the same as `numpy.percentile(method="linear")`                                                           |
| Comparison               | Strictly greater than (`tmax > threshold`), because the assignment says "above"                                                 |
| Minimum event length     | 3 consecutive calendar days                                                                                                     |
| Missing day              | Breaks the run. Nothing is filled in or interpolated.                                                                           |
| Year an event belongs to | The calendar year of its start date                                                                                             |
| Intensity                | How far each day is above the threshold (°C). The absolute peak temperature is also reported.                                   |
| Dependencies             | None added. Pure Python and the standard library. numpy is used only in one test as a cross-check, and it is already installed. |

### Annual vs seasonal thresholds

|                           | Annual fixed percentile (recommended)                                                                                               | Seasonal / calendar-day percentile                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Question it answers       | "Days that are hot compared with all days at this place"                                                                            | "Days that are unusually hot for this time of year"                              |
| Where events fall         | Hot season only                                                                                                                     | Any season, including "winter heatwaves"                                         |
| Match with the assignment | Direct reading of "the 95th percentile for the selected region"                                                                     | Needs a reinterpretation                                                         |
| Hazard meaning            | Absolute heat, which is what drives health and energy impacts                                                                       | Anomaly. A 15 °C "heatwave" in January is not a heat hazard.                     |
| Complexity                | One number per location                                                                                                             | 365 or 366 thresholds, a ±7-day window, Feb 29 mapping, about 450 values per day |
| Weaknesses                | Places with little seasonal variation (tropics) get events through a long hot season. In mid-latitudes, events land only in summer. | More edge cases to test; harder to explain to users                              |

The seasonal method would be the standard "warm spell" approach (similar to ETCCDI's daily-percentile indices: a 15-day window centred on each calendar day and pooled across the baseline years). It is **out of scope for Phase 4**. Keep the `threshold_method` field in the result so it can be added later as a new method version without changing the API.

---

# BASELINE_DEFINITION

1. **Period:** 1 January of `baseline_start_year` to 31 December of `baseline_end_year`. Defaults are 1991 and 2020, the current WMO 30-year climate normal, and well inside the 1979-onward satellite era of the reanalysis.
2. **Validation** (any failure raises `HeatwaveServiceError(..., 422)`):
   - `baseline_start_year <= baseline_end_year`
   - Number of years ≥ `heatwave_min_baseline_years` (default 10)
   - `baseline_start_year >= 1940` (taken from `weather_archive_start_date`)
   - `baseline_end_year <= (date.today() - timedelta(days=weather_archive_lag_days)).year - 1`, so the last baseline year is complete
3. **Sample:** every valid `temperature_max_c` in the period, Feb 29 included (see Leap years). Missing days are left out, never filled.
4. **Coverage rule:** `coverage = observation_count / expected_count`, where `expected_count` is the number of calendar days in the period (10,958 for 1991–2020).
   - Coverage below `heatwave_baseline_min_coverage` (0.90) → 422 `"baseline period has insufficient valid observations"`.
   - Any single baseline year below 0.90 adds the warning `baseline_year_low_coverage:<YYYY>` but does not stop the analysis.
5. **Percentile** (Hyndman–Fan type 7, linear):
   ```
   x = sorted(values); n = len(x)            # n == 0 -> ValueError
   h = (n - 1) * q / 100
   lo = floor(h); hi = min(lo + 1, n - 1)
   p = x[lo] + (h - lo) * (x[hi] - x[lo])

   ```
6. **Keeping years comparable:**
   - The threshold is computed **only** from baseline data. It never depends on the analysis window.
   - The same threshold is applied to every analysis year.
   - The result stores `threshold_c`, the baseline years, the percentile, `method_version="heatwave-v1"` and a `params_hash`.
   - The threshold is never rounded inside the service; the frontend formats it. Rounding would make the displayed value disagree with the strict `>` comparison at 0.1 °C resolution.
7. **Diagnostic:** `exceedance_count` = baseline days with `tmax > threshold`. It must be ≤ about 5% of `observation_count`, and fewer when many values tie at 0.1 °C resolution. Report it so users can see how often the threshold is actually exceeded.

---

# EVENT_DETECTION_RULES

The detector walks **calendar days** from `start` to `end`. It must not walk the list of records, because adjacent records are not necessarily adjacent days.

```python
run: list[date] = []
day = start
while day <= end:
    t = observations.get(day)          # absent = missing
    if t is not None and t > threshold:
        run.append(day)
    else:
        close(run); run = []           # close() keeps the run only if len(run) >= min_duration
    day += timedelta(days=1)
close(run)

```

1. **Exceedance day:** a day with a valid observation where `tmax > threshold`. A value exactly equal to the threshold is not an exceedance.
2. **Event:** a *maximal* run of at least `min_duration` (3) consecutive exceedance days.
3. **Missing days:** a missing day ends the run. Five hot days with day 3 missing give two runs of 2 days, so **no event**. Seven hot days with day 4 missing give **two 3-day events**. Neither side of a gap is ever filled in.
4. **Overlap is impossible by construction.** Runs are maximal, so each day belongs to at most one event. A 10-day run is **one** event, not eight overlapping 3-day windows. Two runs separated by a single cooler day are two separate events, never merged.
5. **Window edges:** detection uses only data inside `[start_date, end_date]`. Each event carries three flags:
   - `censored_start = (event.start_date == start)`
   - `censored_end = (event.end_date == end)`
   - `adjacent_missing = True` if the day before or after the event is inside the window and missing. That event might have been longer, or merged with another, if the data existed.
6. **Year boundaries:** detection runs on the continuous series, so an event from Dec 30 to Jan 2 stays one event, attributed to the year of its start date (here the December year).
7. **Defensive input:** a non-finite value from the database (NaN or inf) is treated as missing.

---

# METRICS

All temperatures are in °C. Exceedance is `tmax − threshold_c`, which is always > 0 on heatwave days.

**Per event (`HeatwaveEvent`)**

| Field                                                | Definition                                |
| ---------------------------------------------------- | ----------------------------------------- |
| `start_date`, `end_date`                             | First and last day of the run             |
| `duration_days`                                      | `(end − start).days + 1`                  |
| `year`                                               | `start_date.year`                         |
| `peak_temperature_c`                                 | Maximum tmax                              |
| `mean_temperature_c`                                 | Mean tmax                                 |
| `max_exceedance_c`                                   | Maximum of (tmax − threshold)             |
| `mean_exceedance_c`                                  | Mean of (tmax − threshold)                |
| `cumulative_exceedance_c`                            | Sum of (tmax − threshold), in degree-days |
| `censored_start`, `censored_end`, `adjacent_missing` | bool flags                                |

**Per calendar year** that intersects the window. Every event counts toward the year of its start date.

| Field                                     | Definition                                                                                           | No events in the year |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| `heatwave_count` (**frequency**)          | Number of events                                                                                     | `0`                   |
| `total_heatwave_days`                     | Sum of `duration_days`                                                                               | `0`                   |
| `mean_duration_days` (**duration**)       | `total_heatwave_days / heatwave_count`                                                               | `None`                |
| `max_duration_days`                       | Max of `duration_days`                                                                               | `None`                |
| `max_intensity_c` (**maximum intensity**) | Max of event `max_exceedance_c`                                                                      | `None`                |
| `mean_intensity_c` (**mean intensity**)   | **Day-weighted:** sum of `cumulative_exceedance_c` / `total_heatwave_days`                           | `None`                |
| `peak_temperature_c`                      | Max of event `peak_temperature_c`                                                                    | `None`                |
| `days_expected`                           | Days of this year that fall inside `[start, end]`                                                    | n/a                   |
| `days_observed`                           | Valid observations among those days                                                                  | n/a                   |
| `coverage`                                | `days_observed / days_expected`                                                                      | n/a                   |
| `is_complete`                             | The whole calendar year is inside the window **and** `coverage >= heatwave_year_min_coverage` (0.95) | n/a                   |

Mean intensity is weighted by days, not by events, so a 10-day event counts more than a 3-day one. Example: events with exceedances [1,1,1] and [3,3,3,3,3] give `mean_intensity_c` = 18/8 = **2.25**, not 2.0.

**Summary for the whole window**

- `total_events`, `total_heatwave_days`, `mean_duration_days`, `max_duration_days`, `max_intensity_c`, `mean_intensity_c` (day-weighted) and `peak_temperature_c` are computed over **all** events in the window.
- `complete_years` = number of years with `is_complete`.
- `events_per_complete_year` and `heatwave_days_per_complete_year` use **complete years only**. They are `None` when there are no complete years.

**How incomplete years are handled**

- Incomplete years (a partial window, the current year still inside the archive lag, or low coverage) are still reported with `is_complete=false`.
- They are left out of the per-year rates.
- Phase 5 trend analysis must use only years with `is_complete=true`.
- The frontend should show incomplete years differently, for example hatched or greyed.

---

# EDGE_CASES

| Case                                                                            | Expected behaviour                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Value exactly equal to the threshold                                            | Not an exceedance                                                                                                     |
| Run of exactly 3 days                                                           | Event; run of 2 days: no event                                                                                        |
| Missing day in the middle of a run                                              | Run is split. Each side is an event only if it has ≥ 3 days, and gets `adjacent_missing=True`.                        |
| Run touching the window start or end                                            | Event kept, with `censored_start` / `censored_end`                                                                    |
| Window shorter than 3 days                                                      | Valid request with zero events                                                                                        |
| Every day in the window is an exceedance                                        | One event, censored at both ends                                                                                      |
| Event crosses Dec 31 → Jan 1                                                    | One event, `year` = start year; days are not split between years                                                      |
| Feb 28 → 29 → Mar 1 (leap year)                                                 | Contiguous, 3-day event                                                                                               |
| Feb 28 → Mar 1 (non-leap year)                                                  | Contiguous, because days are counted with date arithmetic                                                             |
| Leap-year expected days                                                         | 366, used in coverage. Annual counts are **not** rescaled to 365; the one-day difference is negligible.               |
| Feb 29 in the baseline                                                          | Included in the sample like any other day. The annual method needs no day-of-year mapping.                            |
| Baseline values all identical                                                   | Threshold equals that value, and strict `>` gives zero exceedances                                                    |
| Baseline coverage < 0.90                                                        | 422                                                                                                                   |
| Baseline shorter than 10 years, baseline end in an incomplete year, start > end | 422                                                                                                                   |
| Analysis window overlaps baseline                                               | Allowed; warning `analysis_overlaps_baseline`                                                                         |
| No valid observations in the analysis window                                    | 422 `"no valid temperature observations in analysis window"`                                                          |
| Missing dates returned by `ingest`                                              | Collected into `data_quality.missing_dates`; warning `analysis_missing_days:<N>`                                      |
| Record `date` comes back as a `datetime`                                        | Convert with `.date()` defensively (`_stored_records` already does this)                                              |
| Southern Hemisphere                                                             | Summer spans two calendar years. Events stay whole but are attributed to the start year (documented as a known bias). |
| Open-Meteo error or timeout during a chunk                                      | `WeatherServiceError` propagates unchanged, and the router maps it as `/api/weather` does                             |

---

# SERVICE_INTERFACE

## Config additions (`app/config.py`)

```python
heatwave_baseline_start_year: int = 1991
heatwave_baseline_end_year: int = 2020
heatwave_min_baseline_years: int = 10
heatwave_percentile: float = 95.0
heatwave_min_duration_days: int = 3
heatwave_baseline_min_coverage: float = 0.90
heatwave_year_min_coverage: float = 0.95
heatwave_max_analysis_years: int = 90

```

## `app/services/heatwave_service.py`

**Pure functions.** They do no I/O and carry most of the unit tests.

```python
METHOD_VERSION = "heatwave-v1"
ANALYSIS_TYPE = "heatwave"

class HeatwaveServiceError(Exception):           # same shape as WeatherServiceError
    def __init__(self, message: str, status_code: int = 422): ...

@dataclass(frozen=True)
class Baseline:
    start_year: int; end_year: int; percentile: float
    threshold_c: float
    observation_count: int; expected_count: int; coverage: float
    exceedance_count: int
    low_coverage_years: list[int]

@dataclass(frozen=True)
class HeatwaveEvent:
    start_date: date; end_date: date; duration_days: int; year: int
    peak_temperature_c: float; mean_temperature_c: float
    max_exceedance_c: float; mean_exceedance_c: float; cumulative_exceedance_c: float
    censored_start: bool; censored_end: bool; adjacent_missing: bool

def percentile_linear(values: Sequence[float], q: float) -> float
def compute_baseline(observations: Mapping[date, float], start_year: int, end_year: int,
                     percentile: float = 95.0, min_coverage: float = 0.90) -> Baseline
def detect_events(observations: Mapping[date, float], start: date, end: date,
                  threshold: float, min_duration: int = 3) -> list[HeatwaveEvent]
def annual_metrics(events: Sequence[HeatwaveEvent], observations: Mapping[date, float],
                   start: date, end: date, min_coverage: float = 0.95) -> list[dict[str, Any]]
def summarize(events: Sequence[HeatwaveEvent], annual: Sequence[dict[str, Any]]) -> dict[str, Any]
def year_chunks(start: date, end: date) -> list[tuple[date, date]]   # splits at Jan 1, clipped to [start, end]
def params_hash(baseline_start_year, baseline_end_year, percentile, min_duration,
                baseline_min_coverage, year_min_coverage) -> str     # sha256 of "heatwave-v1|..." joined with "|"

```

**The service class** follows the same pattern as `WeatherService`.

```python
class HeatwaveService:
    def __init__(self, db=None, settings=None, weather_service: WeatherService | None = None):
        self.settings = settings or get_settings()
        self.db = db
        self.weather = weather_service or WeatherService(db, self.settings)

    def _db(self): ...   # same as WeatherService._db

    def validate_request(self, latitude, longitude, start, end, baseline_start_year, baseline_end_year) -> None
        # lat/lon bounds; start <= end; archive bounds (same rule as WeatherService.validate_request);
        # (end.year - start.year + 1) <= heatwave_max_analysis_years; baseline rules from BASELINE_DEFINITION

    def _load_series(self, latitude, longitude, start, end) -> tuple[dict[date, float], set[date], list[str]]
        # for each (s, e) in year_chunks(start, end): r = self.weather.ingest(latitude, longitude, s, e)
        # merge r["records"] -> {date: float(temperature_max_c)}, skipping non-finite values;
        # merge set(r["missing_dates"]) and r["warnings"]

    def analyze(self, latitude, longitude, start_date, end_date,
                baseline_start_year: int | None = None, baseline_end_year: int | None = None) -> dict[str, Any]
        # 1 fill defaults from settings  2 validate  3 load baseline series -> compute_baseline
        # 4 load analysis series (raise 422 if empty)  5 detect_events  6 annual_metrics  7 summarize
        # 8 build warnings  9 build result dict  10 self._save(result)  11 return result

    def _save(self, result: dict[str, Any]) -> None   # upsert into analysis_results

```

- **Loading in chunks:** each chunk is at most 366 days, which is within the current `weather_max_range_days`. If `weather_max_range_days < 366`, `__init__` should raise `RuntimeError`.
- **First-load cost:** the first analysis at a new location makes about 30 Open-Meteo calls for the baseline. After that, `ingest()` serves the data from MongoDB, so nothing in `weather_service.py` needs to change.
- **Overlapping ranges need no deduplication.** When an analysis chunk overlaps stored days, `ingest()` finds the existing records and skips the network fetch.
- **`location_key`:** compute it with `location_key(latitude, longitude)`. Do not take it from `records[0]`, because `ingest()` returns `None` when there are no records.

## Result dict and `analysis_results` document

The API returns Python `date` values. `_save` stores a **copy** in which every `date` is converted with `_to_datetime` (import it from `weather_service` so midnight UTC is defined in one place). `missing_dates` is stored as ISO strings, the same way `ingestion_cache.covered_dates` is.

```python
{
  "location_key": "28.613900,77.209000",
  "analysis_type": "heatwave",
  "latitude": 28.6139, "longitude": 77.209,
  "start_date": date, "end_date": date,
  "method": {
    "method_version": "heatwave-v1", "threshold_method": "annual_fixed_baseline",
    "percentile": 95.0, "interpolation": "linear", "comparison": "gt",
    "min_duration_days": 3, "missing_day_policy": "breaks_event",
    "year_attribution": "event_start_date", "intensity_reference": "exceedance_above_threshold",
    "baseline_min_coverage": 0.90, "year_min_coverage": 0.95,
  },
  "params_hash": "<sha256 hex>",
  "baseline": {start_year, end_year, percentile, threshold_c, observation_count,
               expected_count, coverage, exceedance_count, low_coverage_years},
  "events": [HeatwaveEvent as dict, ...],
  "annual": [{year, days_expected, days_observed, coverage, is_complete, heatwave_count,
              total_heatwave_days, mean_duration_days, max_duration_days,
              max_intensity_c, mean_intensity_c, peak_temperature_c}, ...],
  "summary": {total_events, total_heatwave_days, complete_years, events_per_complete_year,
              heatwave_days_per_complete_year, mean_duration_days, max_duration_days,
              max_intensity_c, mean_intensity_c, peak_temperature_c},
  "data_quality": {"analysis_coverage": float, "missing_dates": [date, ...], "warnings": [str, ...]},
  "source": "open-meteo-archive",
  "computed_at": datetime,   # UTC
}

```

`_save` upsert:

- filter: `{location_key, analysis_type, start_date, end_date, params_hash}`. The first four fields are the prefix of the existing `location_type_range` index.
- update: `{"$set": {...doc, "updated_at": now}, "$setOnInsert": {"created_at": now}}`

In Phase 4, saved results are a **record of past runs, not a cache**. Every call recomputes, which takes milliseconds for about 15,000 values. That way, days that were missing earlier and are filled in later are always picked up.

## Pydantic schemas (`app/schemas/analysis.py`)

`HeatwaveMethod`, `BaselineInfo`, `HeatwaveEventResponse`, `AnnualHeatwaveMetrics`, `HeatwaveSummary`, `DataQuality` and `HeatwaveAnalysisResponse`, with fields matching the dict above. Use `ConfigDict(extra="ignore")` like `WeatherRecordResponse`. Optional metrics are `float | None` / `int | None`.

## Router (`app/routers/analysis.py`, registered in `main.py`)

```python
router = APIRouter(prefix="/api", tags=["analysis"])

@router.get("/heatwaves", response_model=HeatwaveAnalysisResponse)
def get_heatwaves(latitude: float = Query(..., ge=-90, le=90), longitude: float = Query(..., ge=-180, le=180),
                  start_date: date = Query(...), end_date: date = Query(...),
                  baseline_start_year: int | None = Query(None), baseline_end_year: int | None = Query(None)):
    # HeatwaveServiceError / WeatherServiceError -> HTTPException(exc.status_code, {"error": exc.message})

```

---

# TEST_PLAN

**`tests/test_heatwave_service.py`** contains unit tests only: no MongoDB, no network. They use a fake `weather_service` whose `ingest` builds records from a `dict[date, float]`.

| #  | Test                                                | Assertion                                                                                                                                                                                                                                                                        |
| -- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | `test_percentile_linear_known_values`               | `[1,2,3,4,5]`, q=95 → **4.8**; `range(1,101)`, q=95 → **95.05**; q=0 → min; q=100 → max; `[7]` → 7                                                                                                                                                                               |
| 2  | `test_percentile_matches_numpy`                     | 1,000 values from a seeded random generator; equals `numpy.percentile(..., 95, method="linear")` within `pytest.approx`                                                                                                                                                          |
| 3  | `test_percentile_empty_raises`                      | `ValueError`                                                                                                                                                                                                                                                                     |
| 4  | `test_baseline_threshold_and_exceedance_fraction`   | `exceedance_count / observation_count <= 0.05 + 1/n`                                                                                                                                                                                                                             |
| 5  | `test_baseline_low_coverage_raises`                 | 85% coverage → `HeatwaveServiceError`, status 422                                                                                                                                                                                                                                |
| 6  | `test_baseline_low_coverage_year_warns`             | One year at 80% with overall coverage ≥ 90% → year listed in `low_coverage_years`                                                                                                                                                                                                |
| 7  | `test_baseline_constant_values_no_exceedance`       | Threshold equals the constant; `exceedance_count == 0`                                                                                                                                                                                                                           |
| 8  | `test_detect_basic_events`                          | Threshold 30, from 2024-07-01: `[31,32,33,29,31,31,29,35,36,37,38]` → 2 events. **Event 1:** Jul 1–3, duration 3, peak 33, max exceedance 3, mean exceedance 2, cumulative 6. **Event 2:** Jul 8–11, duration 4, max exceedance 8, mean 6.5, cumulative 26, `censored_end=True`. |
| 9  | `test_equal_to_threshold_is_not_exceedance`         | `[30,31,32,33]` with threshold 30 → one event, Jul 2–4; `[30,30,30]` → none                                                                                                                                                                                                      |
| 10 | `test_two_day_run_is_not_event`                     | —                                                                                                                                                                                                                                                                                |
| 11 | `test_missing_day_breaks_run`                       | 5 hot days with day 3 missing → 0 events                                                                                                                                                                                                                                         |
| 12 | `test_missing_day_splits_into_two_events`           | 7 hot days with day 4 missing → 2 events, both `adjacent_missing=True`                                                                                                                                                                                                           |
| 13 | `test_detection_uses_calendar_not_record_adjacency` | Records for Jul 1, 2, 4, 5, 6 (Jul 3 absent), all hot → only Jul 4–6 is an event                                                                                                                                                                                                 |
| 14 | `test_long_run_is_single_event`                     | 10 hot days → 1 event of 10 days                                                                                                                                                                                                                                                 |
| 15 | `test_event_spanning_new_year`                      | Dec 30, 2023 – Jan 2, 2024 → 1 event, year 2023; 2023 `total_heatwave_days=4`, 2024 `=0`                                                                                                                                                                                         |
| 16 | `test_leap_day_contiguity`                          | 2024-02-28/29/03-01 → 3-day event; 2023-02-27/28/03-01 → 3-day event                                                                                                                                                                                                             |
| 17 | `test_window_edge_censoring`                        | Event starting on `start` → `censored_start=True`                                                                                                                                                                                                                                |
| 18 | `test_annual_mean_intensity_is_day_weighted`        | Exceedances [1,1,1] and [3,3,3,3,3] → `mean_intensity_c == 2.25`, `max_intensity_c == 3`, `mean_duration_days == 4`                                                                                                                                                              |
| 19 | `test_annual_zero_events`                           | Complete year with no events → count 0, days 0, the four optional metrics `None`                                                                                                                                                                                                 |
| 20 | `test_partial_year_not_complete`                    | Window 2024-01-01 → 2024-06-30 → `is_complete=False`, `days_expected=182`                                                                                                                                                                                                        |
| 21 | `test_year_coverage_threshold`                      | Full 2024 window with 18 missing days (348/366 = 0.9508) → complete; 19 missing (347/366) → incomplete                                                                                                                                                                           |
| 22 | `test_summary_rates_use_complete_years_only`        | Mix of complete and incomplete years; `events_per_complete_year` computed from complete years only                                                                                                                                                                               |
| 23 | `test_year_chunks`                                  | 2019-06-01 → 2021-03-31 gives `[(2019-06-01, 2019-12-31), (2020-01-01, 2020-12-31), (2021-01-01, 2021-03-31)]`                                                                                                                                                                   |
| 24 | `test_threshold_independent_of_analysis_window`     | Same baseline, two different analysis windows → identical `threshold_c`                                                                                                                                                                                                          |
| 25 | `test_validation_errors`                            | Baseline start > end; baseline < 10 years; baseline end year incomplete; analysis start > end; span > max years → all 422                                                                                                                                                        |
| 26 | `test_missing_dates_propagate_to_data_quality`      | Fake `ingest` returns `missing_dates` → they appear in `data_quality.missing_dates` and a warning is added                                                                                                                                                                       |
| 27 | `test_overlap_warning`                              | Analysis window inside the baseline → `analysis_overlaps_baseline` warning                                                                                                                                                                                                       |
| 28 | `test_no_analysis_observations_raises`              | 422                                                                                                                                                                                                                                                                              |
| 29 | `test_analyze_is_deterministic`                     | Two runs give identical output apart from `computed_at`                                                                                                                                                                                                                          |
| 30 | `test_heatwave_endpoint_response_schema`            | Patch `app.routers.analysis.HeatwaveService`; the result validates against `HeatwaveAnalysisResponse` (same pattern as `test_weather_endpoint_response_schema`)                                                                                                                  |
| 31 | `test_endpoint_maps_service_error`                  | `HeatwaveServiceError` → `HTTPException` with the same status code                                                                                                                                                                                                               |

**`tests/test_heatwave_integration.py`** is marked `integration`. It reuses the `live_db` fixture pattern and mocks `WeatherService._fetch` with a deterministic synthetic generator (not real climate data).

| #  | Test                                         | Assertion                                                                                                                                                                  |
| -- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32 | `test_analyze_persists_result_idempotently`  | Short baseline (e.g. 2010–2019) plus one analysis year. One document in `analysis_results`; `start_date` stored as a `datetime`; running again still leaves **1** document |
| 33 | `test_second_analysis_reuses_stored_weather` | `_fetch.call_count` does not increase on the second `analyze`                                                                                                              |
| 34 | `test_get_heatwaves_endpoint`                | `TestClient` call returns 200 and the schema validates; `latitude=95` → 422                                                                                                |

The existing 16 tests must still pass unchanged.

---

# ASSUMPTIONS

This block can go into the README as written.

> ### Heatwave detection: method and assumptions (`heatwave-v1`)
>
> - **Definition:** a heatwave is ≥ 3 consecutive calendar days on which the daily maximum 2 m temperature is **strictly above** the location's 95th-percentile threshold.
> - **Region:** the single Open-Meteo grid cell nearest to the requested coordinates. This is a reanalysis grid cell, not a station and not an area average.
> - **Threshold:** one annual (all-season) 95th percentile of daily maximum temperature over a fixed baseline (default 1991–2020), using linear interpolation (`numpy.percentile` default). The same threshold is applied to every analysis year, so years can be compared directly.
> - **Missing data:** missing days are never filled in. A missing day ends a run of hot days, so the counts may be **underestimates** where data are missing. Events next to missing data are flagged.
> - **Calendar:** days are UTC calendar days (Open-Meteo `timezone=UTC`). Leap days are handled with ordinary date arithmetic. Feb 29 is part of the baseline, and leap years expect 366 days.
> - **Year attribution:** an event belongs to the calendar year in which it starts, even if it continues into the next year.
> - **Intensity:** reported as °C above the threshold. Mean intensity is weighted by days. The absolute peak temperature is reported separately.
> - **Incomplete years:** a year is complete only if it lies wholly inside the requested window and has ≥ 95% valid days. Incomplete years are shown but left out of per-year rates and future trend analysis.
> - **Baseline quality:** the baseline needs ≥ 90% valid days overall and at least 10 complete years.
>
> **Known limitations and biases**
>
> 1. **Baseline years used as analysis years:** years inside the baseline are measured against a threshold they helped set. By construction about 5% of baseline days exceed it, which slightly distorts comparisons between baseline and later years.
> 2. **Annual threshold:** events happen only in the hot season. "Unusually warm for the season" events (e.g. in winter) are not detected by design.
> 3. **Resolution and ties:** values are reported to 0.1 °C and the comparison is strict, so fewer than 5% of days may exceed the threshold.
> 4. **Daily maximum only:** humidity and night-time temperatures are ignored, so health-relevant heat stress may be underestimated.
> 5. **Grid-cell smoothing:** reanalysis cells can underestimate local extremes, urban heat islands and effects of elevation differences.
> 6. **UTC days:** at locations far from UTC, the "day" is shifted against local time, and one hot afternoon can affect two neighbouring UTC days. This is applied the same way to baseline and analysis data, so the threshold stays internally consistent.
> 7. **Data revisions:** the most recent weeks of reanalysis data are preliminary and may be revised. Cached records are not refreshed automatically.
> 8. **Southern Hemisphere:** summers span two calendar years, so calendar-year statistics split a season between two years.
> 9. **Small numbers:** annual event counts are small integers and noisy. No statistical conclusions are drawn in this phase.
> 10. **Rising frequency is the signal:** against a fixed baseline in a warming climate, recent years are expected to show more events. That is the signal being measured, not an error, but this phase draws no trend conclusions.

---

# IMPLEMENTATION_READINESS

**Ready to implement.** Every decision above is fixed and comes with its default value, and no open questions block the work.

**Suggested order (about 3–4 hours of the budget):**

1. `config.py`: add the settings (5 min).
2. `heatwave_service.py`: write the pure functions with tests 1–24 first (about 1.5 h).
3. `HeatwaveService`: validation, `_load_series`, `analyze` and `_save`, with tests 25–29 (about 1 h).
4. `schemas/analysis.py`, `routers/analysis.py`, and register the router in `main.py`, with tests 30–31 (about 30 min).
5. Integration tests 32–34 (about 30 min).
6. Add the assumptions block to `backend/README.md`, which is currently empty.

**Do not:**

- modify `weather_service.py`
- add dependencies (pandas and scipy are not needed here)
- implement seasonal thresholds or trend analysis
- fill in or interpolate temperatures
- round the threshold
- use saved `analysis_results` as a read cache

**Things to expect:**

- **First request at a new location:** it makes about 30 sequential Open-Meteo calls for the baseline, which may take tens of seconds. Later requests read from MongoDB. The frontend should show a loading state.
- **CORS:** it allows only GET; `/api/heatwaves` is a GET, so nothing changes.

I haven't changed any code or files. I can save this design as a markdown file in the repo (for example `docs/phase4_heatwave_design.md`) so Codex can read it directly.