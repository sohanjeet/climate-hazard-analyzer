"""Heatwave detection (method ``heatwave-v1``).

A heatwave is a run of >= 3 consecutive calendar days whose daily maximum
temperature is strictly above one fixed, all-season 95th-percentile threshold
computed from a fixed reference period (default 1991-2020). Missing days are
never filled in; they end a run. See docs/phase4a_heatwave_design.md.
"""

from __future__ import annotations

import hashlib
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from pymongo.errors import DuplicateKeyError, PyMongoError

from app import database
from app.config import Settings, get_settings
from app.services.trend_service import TrendServiceError, compute_trends, validate_rolling_window
from app.services.weather_service import WeatherService, _to_datetime, location_key

logger = logging.getLogger(__name__)

METHOD_VERSION = "heatwave-v1"
ANALYSIS_TYPE = "heatwave"


class HeatwaveServiceError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class Baseline:
    start_year: int
    end_year: int
    percentile: float
    threshold_c: float
    observation_count: int
    expected_count: int
    coverage: float
    exceedance_count: int
    low_coverage_years: list[int]


@dataclass(frozen=True)
class HeatwaveEvent:
    start_date: date
    end_date: date
    duration_days: int
    year: int
    peak_temperature_c: float
    mean_temperature_c: float
    max_exceedance_c: float
    mean_exceedance_c: float
    cumulative_exceedance_c: float
    censored_start: bool
    censored_end: bool
    adjacent_missing: bool


# --------------------------------------------------------------------------- pure functions


def _valid(observations: Mapping[date, float], day: date) -> float | None:
    """Return the observation for ``day``, or None if absent or non-finite."""
    value = observations.get(day)
    if value is None or not math.isfinite(value):
        return None
    return value


def _days_in_range(start: date, end: date) -> int:
    return (end - start).days + 1


def percentile_linear(values: Sequence[float], q: float) -> float:
    """Hyndman-Fan type 7; identical to ``numpy.percentile(method="linear")``."""
    x = sorted(values)
    n = len(x)
    if n == 0:
        raise ValueError("cannot compute a percentile of an empty sequence")
    h = (n - 1) * q / 100
    lo = math.floor(h)
    hi = min(lo + 1, n - 1)
    return x[lo] + (h - lo) * (x[hi] - x[lo])


def compute_baseline(
    observations: Mapping[date, float],
    start_year: int,
    end_year: int,
    percentile: float = 95.0,
    min_coverage: float = 0.90,
) -> Baseline:
    period_start, period_end = date(start_year, 1, 1), date(end_year, 12, 31)
    values: list[float] = []
    observed_by_year: dict[int, int] = {}
    for day in observations:
        if not period_start <= day <= period_end:
            continue
        value = _valid(observations, day)
        if value is None:
            continue
        values.append(value)
        observed_by_year[day.year] = observed_by_year.get(day.year, 0) + 1

    expected = _days_in_range(period_start, period_end)
    coverage = len(values) / expected
    if not values or coverage < min_coverage:
        raise HeatwaveServiceError("baseline period has insufficient valid observations", 422)

    low_years = [
        year for year in range(start_year, end_year + 1)
        if observed_by_year.get(year, 0) / _days_in_range(date(year, 1, 1), date(year, 12, 31)) < min_coverage
    ]
    threshold = percentile_linear(values, percentile)
    return Baseline(
        start_year=start_year,
        end_year=end_year,
        percentile=percentile,
        threshold_c=threshold,
        observation_count=len(values),
        expected_count=expected,
        coverage=coverage,
        exceedance_count=sum(1 for v in values if v > threshold),
        low_coverage_years=low_years,
    )


def detect_events(
    observations: Mapping[date, float],
    start: date,
    end: date,
    threshold: float,
    min_duration: int = 3,
) -> list[HeatwaveEvent]:
    """Walk calendar days (not records) and return maximal runs of exceedance days."""
    events: list[HeatwaveEvent] = []

    def close(run: list[date]) -> None:
        if len(run) < min_duration:
            return
        first, last = run[0], run[-1]
        temps = [observations[d] for d in run]
        exceed = [t - threshold for t in temps]
        before, after = first - timedelta(days=1), last + timedelta(days=1)
        adjacent_missing = (start <= before and _valid(observations, before) is None) or (
            after <= end and _valid(observations, after) is None
        )
        events.append(HeatwaveEvent(
            start_date=first,
            end_date=last,
            duration_days=(last - first).days + 1,
            year=first.year,
            peak_temperature_c=max(temps),
            mean_temperature_c=sum(temps) / len(temps),
            max_exceedance_c=max(exceed),
            mean_exceedance_c=sum(exceed) / len(exceed),
            cumulative_exceedance_c=sum(exceed),
            censored_start=first == start,
            censored_end=last == end,
            adjacent_missing=adjacent_missing,
        ))

    run: list[date] = []
    day = start
    while day <= end:
        t = _valid(observations, day)
        if t is not None and t > threshold:
            run.append(day)
        else:
            close(run)
            run = []
        day += timedelta(days=1)
    close(run)
    return events


def annual_metrics(
    events: Sequence[HeatwaveEvent],
    observations: Mapping[date, float],
    start: date,
    end: date,
    min_coverage: float = 0.95,
) -> list[dict[str, Any]]:
    by_year: dict[int, list[HeatwaveEvent]] = {}
    for event in events:
        by_year.setdefault(event.year, []).append(event)

    rows: list[dict[str, Any]] = []
    for year in range(start.year, end.year + 1):
        first, last = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        expected = _days_in_range(first, last)
        observed = sum(1 for i in range(expected) if _valid(observations, first + timedelta(days=i)) is not None)
        coverage = observed / expected
        whole_year = start <= date(year, 1, 1) and end >= date(year, 12, 31)
        year_events = by_year.get(year, [])
        total_days = sum(e.duration_days for e in year_events)
        rows.append({
            "year": year,
            "days_expected": expected,
            "days_observed": observed,
            "coverage": coverage,
            "is_complete": whole_year and coverage >= min_coverage,
            "heatwave_count": len(year_events),
            "total_heatwave_days": total_days,
            "mean_duration_days": total_days / len(year_events) if year_events else None,
            "max_duration_days": max((e.duration_days for e in year_events), default=None),
            "max_intensity_c": max((e.max_exceedance_c for e in year_events), default=None),
            "mean_intensity_c": (
                sum(e.cumulative_exceedance_c for e in year_events) / total_days if year_events else None
            ),
            "peak_temperature_c": max((e.peak_temperature_c for e in year_events), default=None),
        })
    return rows


def summarize(events: Sequence[HeatwaveEvent], annual: Sequence[dict[str, Any]]) -> dict[str, Any]:
    total_days = sum(e.duration_days for e in events)
    complete = [row for row in annual if row["is_complete"]]
    return {
        "total_events": len(events),
        "total_heatwave_days": total_days,
        "complete_years": len(complete),
        "events_per_complete_year": (
            sum(r["heatwave_count"] for r in complete) / len(complete) if complete else None
        ),
        "heatwave_days_per_complete_year": (
            sum(r["total_heatwave_days"] for r in complete) / len(complete) if complete else None
        ),
        "mean_duration_days": total_days / len(events) if events else None,
        "max_duration_days": max((e.duration_days for e in events), default=None),
        "max_intensity_c": max((e.max_exceedance_c for e in events), default=None),
        "mean_intensity_c": sum(e.cumulative_exceedance_c for e in events) / total_days if events else None,
        "peak_temperature_c": max((e.peak_temperature_c for e in events), default=None),
    }


def year_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split [start, end] at Jan 1 so every chunk is at most one calendar year."""
    chunks = []
    for year in range(start.year, end.year + 1):
        chunks.append((max(start, date(year, 1, 1)), min(end, date(year, 12, 31))))
    return chunks


def params_hash(
    baseline_start_year: int,
    baseline_end_year: int,
    percentile: float,
    min_duration: int,
    baseline_min_coverage: float,
    year_min_coverage: float,
) -> str:
    parts = [METHOD_VERSION, baseline_start_year, baseline_end_year, percentile, min_duration,
             baseline_min_coverage, year_min_coverage]
    return hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- service


def _bson_safe(value: Any) -> Any:
    """Recursively convert datetime.date to midnight-UTC datetime (BSON has no date type)."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return _to_datetime(value)
    if isinstance(value, dict):
        return {k: _bson_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_bson_safe(v) for v in value]
    return value


class HeatwaveService:
    source = WeatherService.source

    def __init__(self, db: Any | None = None, settings: Settings | None = None,
                 weather_service: WeatherService | None = None):
        self.settings = settings or get_settings()
        if self.settings.weather_max_range_days < 366:
            raise RuntimeError("weather_max_range_days must be >= 366 to load one calendar year per request")
        self.db = db
        self.weather = weather_service or WeatherService(db, self.settings)

    def _db(self):
        return self.db if self.db is not None else database.get_db(self.settings)

    def validate_request(self, latitude: float, longitude: float, start: date, end: date,
                         baseline_start_year: int, baseline_end_year: int) -> None:
        s = self.settings
        if not -90 <= latitude <= 90:
            raise HeatwaveServiceError("latitude must be between -90 and 90", 422)
        if not -180 <= longitude <= 180:
            raise HeatwaveServiceError("longitude must be between -180 and 180", 422)
        if start > end:
            raise HeatwaveServiceError("start_date must be on or before end_date", 422)
        archive_start = date.fromisoformat(s.weather_archive_start_date)
        archive_end = date.today() - timedelta(days=s.weather_archive_lag_days)
        if start < archive_start or end > archive_end:
            raise HeatwaveServiceError(
                f"dates must be between {archive_start.isoformat()} and {archive_end.isoformat()} for the historical archive",
                422,
            )
        if end.year - start.year + 1 > s.heatwave_max_analysis_years:
            raise HeatwaveServiceError(
                f"analysis window cannot exceed {s.heatwave_max_analysis_years} calendar years", 422
            )
        if baseline_start_year > baseline_end_year:
            raise HeatwaveServiceError("baseline_start_year must be on or before baseline_end_year", 422)
        if baseline_end_year - baseline_start_year + 1 < s.heatwave_min_baseline_years:
            raise HeatwaveServiceError(
                f"baseline must span at least {s.heatwave_min_baseline_years} calendar years", 422
            )
        if baseline_start_year < archive_start.year:
            raise HeatwaveServiceError(f"baseline_start_year must be {archive_start.year} or later", 422)
        last_complete_year = archive_end.year - 1
        if baseline_end_year > last_complete_year:
            raise HeatwaveServiceError(
                f"baseline_end_year must be {last_complete_year} or earlier so the baseline year is complete", 422
            )

    def _ingest_chunks(self, latitude: float, longitude: float,
                       chunks: list[tuple[date, date]]) -> list[dict[str, Any]]:
        """Ingest yearly chunks with at most ``weather_fetch_concurrency`` running at once.

        Chunks cover disjoint dates, so their upserts never touch the same document. On the first
        failure, chunks that have not started are cancelled and the error is re-raised.
        """
        workers = min(self.settings.weather_fetch_concurrency, len(chunks))
        if workers <= 1:
            return [self.weather.ingest(latitude, longitude, a, b) for a, b in chunks]
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ingest") as executor:
            futures = [executor.submit(self.weather.ingest, latitude, longitude, a, b) for a, b in chunks]
            try:
                return [future.result() for future in futures]
            except BaseException:
                for future in futures:
                    future.cancel()  # only chunks that have not started; running ones finish within their timeouts
                raise

    def _load_series(self, latitude: float, longitude: float, start: date, end: date
                     ) -> tuple[dict[date, float], set[date], list[str]]:
        """Load [start, end], reading an already-warm range with one indexed query.

        Cold and partially populated ranges retain the established yearly ingestion
        path (and its <=366-day upstream request limit).  A complete warm range used
        to issue one record query and one ingestion-cache query *per year*; the
        durable record store lets us answer it with one range query instead.
        """
        if isinstance(self.weather, WeatherService):
            existing = self.weather.stored_records(latitude, longitude, start, end)
            expected = _days_in_range(start, end)
            if len(existing) == expected:
                series = {
                    day: value
                    for day, record in existing.items()
                    if math.isfinite(value := float(record["temperature_max_c"]))
                }
                # Stored documents pass WeatherService's finite-value validation;
                # keep the fallback correct if legacy data ever does not.
                if len(series) == expected:
                    return series, set(), []

        series: dict[date, float] = {}
        missing: set[date] = set()
        warnings: list[str] = []
        # Results are merged in chunk order whatever the completion order, so the output is
        # identical to sequential loading.
        for result in self._ingest_chunks(latitude, longitude, year_chunks(start, end)):
            for record in result["records"]:
                day = record["date"]
                if isinstance(day, datetime):
                    day = day.date()
                value = float(record["temperature_max_c"])
                if math.isfinite(value):
                    series[day] = value
                else:
                    missing.add(day)
            missing |= set(result["missing_dates"])
            warnings.extend(result["warnings"])
        return series, missing, warnings

    def _load_analysis_series(self, latitude: float, longitude: float, start: date, end: date,
                              baseline_series: Mapping[date, float], baseline_first: date,
                              baseline_last: date) -> tuple[dict[date, float], set[date], list[str]]:
        """Reuse the baseline slice when the requested analysis overlaps it."""
        series = {
            day: value for day, value in baseline_series.items()
            if max(start, baseline_first) <= day <= min(end, baseline_last)
        }
        warnings: list[str] = []
        for part_start, part_end in ((start, min(end, baseline_first - timedelta(days=1))),
                                     (max(start, baseline_last + timedelta(days=1)), end)):
            if part_start > part_end:
                continue
            part, _, part_warnings = self._load_series(latitude, longitude, part_start, part_end)
            series.update(part)
            warnings.extend(part_warnings)
        requested = {start + timedelta(days=offset) for offset in range(_days_in_range(start, end))}
        return series, requested - set(series), warnings

    def load_series(self, latitude: float, longitude: float, start: date, end: date
                    ) -> tuple[dict[date, float], set[date], list[str]]:
        """Public entry for other services (anomalies) that share this ingestion path and its caches."""
        return self._load_series(latitude, longitude, start, end)

    def analyze(self, latitude: float, longitude: float, start_date: date, end_date: date,
                baseline_start_year: int | None = None, baseline_end_year: int | None = None,
                rolling_window_years: int | None = None) -> dict[str, Any]:
        s = self.settings
        window = rolling_window_years if rolling_window_years is not None else s.trend_rolling_window_years
        try:
            validate_rolling_window(window)
        except TrendServiceError as exc:
            raise HeatwaveServiceError(str(exc), 422) from None
        b_start = baseline_start_year if baseline_start_year is not None else s.heatwave_baseline_start_year
        b_end = baseline_end_year if baseline_end_year is not None else s.heatwave_baseline_end_year
        self.validate_request(latitude, longitude, start_date, end_date, b_start, b_end)

        baseline_series, _, _ = self._load_series(latitude, longitude, date(b_start, 1, 1), date(b_end, 12, 31))
        baseline = compute_baseline(baseline_series, b_start, b_end, s.heatwave_percentile,
                                    s.heatwave_baseline_min_coverage)

        series, missing, weather_warnings = self._load_analysis_series(
            latitude, longitude, start_date, end_date, baseline_series, date(b_start, 1, 1), date(b_end, 12, 31))
        if not series:
            raise HeatwaveServiceError("no valid temperature observations in analysis window", 422)

        events = detect_events(series, start_date, end_date, baseline.threshold_c, s.heatwave_min_duration_days)
        annual = annual_metrics(events, series, start_date, end_date, s.heatwave_year_min_coverage)
        summary = summarize(events, annual)

        warnings = set(weather_warnings)
        warnings.update(f"baseline_year_low_coverage:{year}" for year in baseline.low_coverage_years)
        if missing:
            warnings.add(f"analysis_missing_days:{len(missing)}")
        if start_date <= date(b_end, 12, 31) and end_date >= date(b_start, 1, 1):
            warnings.add("analysis_overlaps_baseline")

        trend = compute_trends(
            annual,
            rolling_window_years=window,
            alpha=s.trend_significance_level,
            min_observations=s.trend_min_observations,
            low_power_observations=s.trend_low_power_observations,
            extra_warnings=[w for w in warnings if w == "analysis_overlaps_baseline"],
        )

        expected = _days_in_range(start_date, end_date)
        result = {
            "location_key": location_key(latitude, longitude),
            "analysis_type": ANALYSIS_TYPE,
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "method": {
                "method_version": METHOD_VERSION,
                "threshold_method": "annual_fixed_baseline",
                "percentile": s.heatwave_percentile,
                "interpolation": "linear",
                "comparison": "gt",
                "min_duration_days": s.heatwave_min_duration_days,
                "missing_day_policy": "breaks_event",
                "year_attribution": "event_start_date",
                "intensity_reference": "exceedance_above_threshold",
                "baseline_min_coverage": s.heatwave_baseline_min_coverage,
                "year_min_coverage": s.heatwave_year_min_coverage,
            },
            "params_hash": params_hash(b_start, b_end, s.heatwave_percentile, s.heatwave_min_duration_days,
                                       s.heatwave_baseline_min_coverage, s.heatwave_year_min_coverage),
            "baseline": {
                "start_year": baseline.start_year,
                "end_year": baseline.end_year,
                "percentile": baseline.percentile,
                "threshold_c": baseline.threshold_c,
                "observation_count": baseline.observation_count,
                "expected_count": baseline.expected_count,
                "coverage": baseline.coverage,
                "exceedance_count": baseline.exceedance_count,
                "low_coverage_years": baseline.low_coverage_years,
            },
            "events": [asdict(e) for e in events],
            "annual": annual,
            "summary": summary,
            "trend": trend,
            "data_quality": {
                "analysis_coverage": len(series) / expected,
                "missing_dates": sorted(missing),
                "warnings": sorted(warnings),
            },
            "source": self.source,
            "computed_at": datetime.now(timezone.utc),
        }
        self._save(result)
        return result

    def _save(self, result: dict[str, Any]) -> None:
        """Idempotent upsert; a stored copy uses datetimes (BSON) and ISO strings for missing_dates."""
        doc = _bson_safe({
            **result,
            "data_quality": {
                **result["data_quality"],
                "missing_dates": [d.isoformat() for d in result["data_quality"]["missing_dates"]],
            },
        })
        now = datetime.now(timezone.utc)
        key = {k: doc[k] for k in ("location_key", "analysis_type", "start_date", "end_date", "params_hash")}
        collection = self._db()[database.ANALYSIS_RESULTS]
        update = {"$set": {**doc, "updated_at": now}, "$setOnInsert": {"created_at": now}}
        try:
            try:
                collection.update_one(key, update, upsert=True)
            except DuplicateKeyError:
                # Two first-time requests raced on the unique key; the second now updates the winner's document.
                collection.update_one(key, update, upsert=True)
        except PyMongoError as exc:
            # The stored copy is a record of past runs, never read back, so a failed write must not fail the request.
            logger.error("analysis_result_save_failed error=%s", type(exc).__name__)
