"""Temperature anomalies (method ``temperature-anomaly-v1``).

For each analysis year the annual mean of the daily maximum temperature is compared with the mean of all
valid daily maxima in a fixed baseline period (default 1991-2020, the same baseline the heatwave analysis
uses):

    anomaly_c = annual_mean_daily_max_c - baseline_mean_daily_max_c

This is *not* the mean annual air temperature, the absolute annual maximum, or a heatwave threshold.
Missing or invalid days are excluded, never filled in and never counted as zero. Daily data comes from the
shared ``weather_records`` store through ``HeatwaveService.load_series``, so no extra upstream calls are
made when the data was already ingested. Nothing is persisted: results are cheap to derive from stored
records and the heatwave analysis results collection is left untouched.

Rounding: all arithmetic uses full precision; only the returned values are rounded, temperatures to 2
decimals and coverage fractions to 4. An anomaly is computed from the unrounded means and then rounded, so
it can differ by 0.01 from the difference of the two rounded means. Negative zero is normalised to 0.0.
See docs/temperature_anomaly_design.md.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

from app.config import Settings, get_settings
from app.services.heatwave_service import HeatwaveService, HeatwaveServiceError
from app.services.weather_service import location_key

logger = logging.getLogger(__name__)

METHOD_VERSION = "temperature-anomaly-v1"
ANALYSIS_TYPE = "temperature_anomaly"
TEMPERATURE_DECIMALS = 2
COVERAGE_DECIMALS = 4

# Year statuses. Only "complete" years receive an anomaly.
COMPLETE = "complete"
PARTIAL_YEAR = "partial_year"  # the requested window covers only part of the calendar year
LOW_COVERAGE = "low_coverage"  # whole year requested, but fewer valid days than the minimum coverage
NO_DATA = "no_data"  # not one valid observation


@dataclass(frozen=True)
class BaselineMean:
    start_year: int
    end_year: int
    mean_c: float
    observation_count: int
    expected_count: int
    coverage: float
    low_coverage_years: list[int]


# --------------------------------------------------------------------------- pure functions


def _days(start: date, end: date) -> int:
    return (end - start).days + 1


def round_temperature(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, TEMPERATURE_DECIMALS) + 0.0  # + 0.0 turns -0.0 into 0.0


def round_fraction(value: float) -> float:
    return round(value, COVERAGE_DECIMALS)


def _valid_values(observations: Mapping[date, float], start: date, end: date) -> dict[int, list[float]]:
    """Finite observations inside [start, end] grouped by calendar year."""
    by_year: dict[int, list[float]] = {}
    for day, value in observations.items():
        if start <= day <= end and value is not None and math.isfinite(value):
            by_year.setdefault(day.year, []).append(value)
    return by_year


def compute_baseline_mean(
    observations: Mapping[date, float],
    start_year: int,
    end_year: int,
    min_coverage: float = 0.90,
) -> BaselineMean:
    """Mean of every valid daily maximum in the baseline period (each day weighted equally)."""
    first, last = date(start_year, 1, 1), date(end_year, 12, 31)
    by_year = _valid_values(observations, first, last)
    count = sum(len(v) for v in by_year.values())
    expected = _days(first, last)
    coverage = count / expected
    if count == 0 or coverage < min_coverage:
        raise HeatwaveServiceError("baseline period has insufficient valid observations", 422)
    low_years = [
        year for year in range(start_year, end_year + 1)
        if len(by_year.get(year, [])) / _days(date(year, 1, 1), date(year, 12, 31)) < min_coverage
    ]
    return BaselineMean(
        start_year=start_year,
        end_year=end_year,
        mean_c=math.fsum(v for values in by_year.values() for v in values) / count,
        observation_count=count,
        expected_count=expected,
        coverage=coverage,
        low_coverage_years=low_years,
    )


def annual_anomalies(
    observations: Mapping[date, float],
    start: date,
    end: date,
    baseline_mean_c: float,
    min_coverage: float = 0.95,
) -> list[dict[str, Any]]:
    """One row per calendar year touched by [start, end]."""
    by_year = _valid_values(observations, start, end)
    rows: list[dict[str, Any]] = []
    for year in range(start.year, end.year + 1):
        first, last = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        expected = _days(first, last)
        values = by_year.get(year, [])
        observed = len(values)
        coverage = observed / expected
        whole_year = start <= date(year, 1, 1) and end >= date(year, 12, 31)
        warnings: list[str] = []
        if observed == 0:
            status = NO_DATA
            warnings.append("no_valid_observations")
        elif not whole_year:
            status = PARTIAL_YEAR
            warnings.append("partial_year")
        elif coverage < min_coverage:
            status = LOW_COVERAGE
            warnings.append("low_coverage")
        else:
            status = COMPLETE
        mean = math.fsum(values) / observed if observed else None
        anomaly = mean - baseline_mean_c if mean is not None and status == COMPLETE else None
        rows.append({
            "year": year,
            "annual_mean_daily_max_c": round_temperature(mean),
            "anomaly_c": round_temperature(anomaly),
            "observation_count": observed,
            "expected_count": expected,
            "coverage": round_fraction(coverage),
            "status": status,
            "warnings": warnings,
        })
    return rows


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    complete = [r for r in rows if r["status"] == COMPLETE]
    anomalies = [(r["anomaly_c"], r["year"]) for r in complete]
    means = [r["annual_mean_daily_max_c"] for r in complete]
    warmest = max(anomalies, key=lambda a: (a[0], -a[1]), default=None)  # earliest year wins ties
    coolest = min(anomalies, key=lambda a: (a[0], a[1]), default=None)
    return {
        "years_in_window": len(rows),
        "complete_years": len(complete),
        "mean_anomaly_c": round_temperature(math.fsum(a for a, _ in anomalies) / len(anomalies)) if anomalies else None,
        "mean_annual_daily_max_c": round_temperature(math.fsum(means) / len(means)) if means else None,
        "max_anomaly_c": warmest[0] if warmest else None,
        "max_anomaly_year": warmest[1] if warmest else None,
        "min_anomaly_c": coolest[0] if coolest else None,
        "min_anomaly_year": coolest[1] if coolest else None,
        "positive_years": sum(1 for a, _ in anomalies if a > 0),
        "negative_years": sum(1 for a, _ in anomalies if a < 0),
        "zero_years": sum(1 for a, _ in anomalies if a == 0),
    }


# --------------------------------------------------------------------------- service


class AnomalyService:
    source = HeatwaveService.source

    def __init__(self, db: Any | None = None, settings: Settings | None = None,
                 heatwave_service: HeatwaveService | None = None):
        self.settings = settings or get_settings()
        self.heatwave = heatwave_service or HeatwaveService(db, self.settings)

    def _load_analysis_series(self, latitude: float, longitude: float, start: date, end: date,
                              baseline_series: Mapping[date, float], baseline_first: date, baseline_last: date
                              ) -> tuple[dict[date, float], list[str]]:
        """Fetch only the part of the window outside the baseline; the overlap is sliced from the baseline."""
        series: dict[date, float] = {
            d: v for d, v in baseline_series.items() if max(start, baseline_first) <= d <= min(end, baseline_last)
        }
        warnings: list[str] = []
        outside: list[tuple[date, date]] = []
        if start < baseline_first:
            outside.append((start, min(end, baseline_first - timedelta(days=1))))
        if end > baseline_last:
            outside.append((max(start, baseline_last + timedelta(days=1)), end))
        for a, b in outside:
            part, _, part_warnings = self.heatwave.load_series(latitude, longitude, a, b)
            series.update(part)
            warnings.extend(part_warnings)
        return series, warnings

    def analyze(self, latitude: float, longitude: float, start_date: date, end_date: date,
                baseline_start_year: int | None = None, baseline_end_year: int | None = None) -> dict[str, Any]:
        s = self.settings
        b_start = baseline_start_year if baseline_start_year is not None else s.heatwave_baseline_start_year
        b_end = baseline_end_year if baseline_end_year is not None else s.heatwave_baseline_end_year
        self.heatwave.validate_request(latitude, longitude, start_date, end_date, b_start, b_end)

        b_first, b_last = date(b_start, 1, 1), date(b_end, 12, 31)
        baseline_series, _, baseline_warnings = self.heatwave.load_series(latitude, longitude, b_first, b_last)
        baseline = compute_baseline_mean(baseline_series, b_start, b_end, s.heatwave_baseline_min_coverage)

        series, analysis_warnings = self._load_analysis_series(
            latitude, longitude, start_date, end_date, baseline_series, b_first, b_last)
        in_window = sum(1 for d, v in series.items() if start_date <= d <= end_date and math.isfinite(v))
        if in_window == 0:
            raise HeatwaveServiceError("no valid temperature observations in analysis window", 422)

        rows = annual_anomalies(series, start_date, end_date, baseline.mean_c, s.heatwave_year_min_coverage)
        summary = summarize(rows)

        expected = _days(start_date, end_date)
        warnings = set(baseline_warnings) | set(analysis_warnings)
        warnings.update(f"baseline_year_low_coverage:{year}" for year in baseline.low_coverage_years)
        if expected - in_window:
            warnings.add(f"analysis_missing_days:{expected - in_window}")
        if summary["complete_years"] < summary["years_in_window"]:
            warnings.add(f"years_without_anomaly:{summary['years_in_window'] - summary['complete_years']}")
        if start_date <= b_last and end_date >= b_first:
            warnings.add("analysis_overlaps_baseline")

        return {
            "location_key": location_key(latitude, longitude),
            "analysis_type": ANALYSIS_TYPE,
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "method": {
                "method_version": METHOD_VERSION,
                "metric": "annual_mean_of_daily_maximum_temperature_2m",
                "baseline_statistic": "mean_of_valid_daily_maxima_over_baseline_period",
                "anomaly_formula": "annual_mean_daily_max_c - baseline_mean_daily_max_c",
                "unit": "celsius",
                "temperature_decimals": TEMPERATURE_DECIMALS,
                "coverage_decimals": COVERAGE_DECIMALS,
                "baseline_min_coverage": s.heatwave_baseline_min_coverage,
                "year_min_coverage": s.heatwave_year_min_coverage,
                "missing_value_policy": "excluded_never_filled",
                "incomplete_year_policy": "annual_mean_reported_anomaly_withheld",
            },
            "baseline": {
                "start_year": baseline.start_year,
                "end_year": baseline.end_year,
                "mean_daily_max_c": round_temperature(baseline.mean_c),
                "observation_count": baseline.observation_count,
                "expected_count": baseline.expected_count,
                "coverage": round_fraction(baseline.coverage),
                "low_coverage_years": baseline.low_coverage_years,
            },
            "annual": rows,
            "summary": summary,
            "data_quality": {
                "analysis_coverage": round_fraction(in_window / expected),
                "missing_day_count": expected - in_window,
                "warnings": sorted(warnings),
            },
            "source": self.source,
            "computed_at": datetime.now(timezone.utc),
        }
