"""Temperature anomaly unit tests: no MongoDB, no network, deterministic synthetic series."""
import math
from datetime import date
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.config import Settings
from app.schemas.anomaly import TemperatureAnomalyResponse
from app.services.anomaly_service import (
    COMPLETE,
    LOW_COVERAGE,
    NO_DATA,
    PARTIAL_YEAR,
    AnomalyService,
    annual_anomalies,
    compute_baseline_mean,
    round_temperature,
    summarize,
)
from app.services.heatwave_service import HeatwaveService, HeatwaveServiceError
from tests.test_heatwave_service import FakeWeather, span

B_START, B_END = 2010, 2019
BASELINE_DAYS = span(date(B_START, 1, 1), date(B_END, 12, 31))  # 3652 days, two leap years


def const(days, value):
    return {d: value for d in days}


def year_days(year):
    return span(date(year, 1, 1), date(year, 12, 31))


def make_service(data):
    weather = FakeWeather(data)
    service = AnomalyService(MagicMock(), Settings(), HeatwaveService(MagicMock(), Settings(), weather))
    return service, weather


def analyze(data, start=date(2023, 1, 1), end=date(2023, 12, 31)):
    service, _ = make_service(data)
    return service.analyze(1.0, 2.0, start, end, B_START, B_END)


def row_for(result, year):
    return next(r for r in result["annual"] if r["year"] == year)


# ------------------------------------------------------------------------------ signs


@pytest.mark.parametrize("annual_value,expected", [(31.6, 1.6), (28.4, -1.6), (30.0, 0.0)])
def test_positive_negative_and_zero_anomalies(annual_value, expected):
    data = {**const(BASELINE_DAYS, 30.0), **const(year_days(2023), annual_value)}
    result = analyze(data)
    row = row_for(result, 2023)
    assert result["baseline"]["mean_daily_max_c"] == 30.0
    assert row["annual_mean_daily_max_c"] == annual_value
    assert row["anomaly_c"] == expected
    assert row["status"] == COMPLETE
    if expected == 0:
        assert math.copysign(1, row["anomaly_c"]) == 1  # never negative zero
        assert result["summary"]["zero_years"] == 1


def test_documented_example_from_the_spec():
    data = {**const(BASELINE_DAYS, 30.8), **const(year_days(2023), 32.4)}
    assert row_for(analyze(data), 2023)["anomaly_c"] == 1.6


# ------------------------------------------------------------------------------ means


def test_annual_and_baseline_means_are_plain_means_of_valid_days():
    rng = np.random.default_rng(7)
    baseline = {d: float(v) for d, v in zip(BASELINE_DAYS, rng.uniform(10, 40, len(BASELINE_DAYS)))}
    year = {d: float(v) for d, v in zip(year_days(2023), rng.uniform(10, 40, 365))}
    result = analyze({**baseline, **year})
    assert result["baseline"]["mean_daily_max_c"] == pytest.approx(np.mean(list(baseline.values())), abs=0.005)
    assert row_for(result, 2023)["annual_mean_daily_max_c"] == pytest.approx(np.mean(list(year.values())), abs=0.005)
    expected = float(np.mean(list(year.values()))) - float(np.mean(list(baseline.values())))
    assert row_for(result, 2023)["anomaly_c"] == pytest.approx(expected, abs=0.005)


def test_leap_year_uses_366_days():
    # 365 days at 20 plus one leap day at 56: the mean is over 366 days, not 365.
    leap = const(year_days(2020), 20.0)
    leap[date(2020, 2, 29)] = 56.0
    data = {**const(BASELINE_DAYS, 20.0), **leap}
    result = analyze(data, date(2020, 1, 1), date(2020, 12, 31))
    row = row_for(result, 2020)
    assert row["expected_count"] == row["observation_count"] == 366
    assert row["annual_mean_daily_max_c"] == round((365 * 20 + 56) / 366, 2)
    assert result["baseline"]["expected_count"] == 3652 and result["baseline"]["observation_count"] == 3652


def test_baseline_uses_only_baseline_years():
    data = {**const(BASELINE_DAYS, 25.0), **const(year_days(2009), 99.0), **const(year_days(2020), -50.0),
            **const(year_days(2023), 26.0)}
    result = analyze(data)
    assert result["baseline"]["mean_daily_max_c"] == 25.0
    assert (result["baseline"]["start_year"], result["baseline"]["end_year"]) == (B_START, B_END)
    assert row_for(result, 2023)["anomaly_c"] == 1.0


def test_no_heatwave_events_are_needed():
    # A constant series has no heatwaves at all; anomalies still exist and are independent of them.
    result = analyze({**const(BASELINE_DAYS, 22.0), **const(year_days(2023), 22.5)})
    assert row_for(result, 2023)["anomaly_c"] == 0.5


# ------------------------------------------------------------------------------ missing data


def test_missing_days_are_excluded_not_counted_as_zero():
    year = const(year_days(2023), 30.0)
    for d in span(date(2023, 3, 1), date(2023, 3, 10)):
        del year[d]  # 10 missing days: 355/365 = 97.3% >= 95%
    result = analyze({**const(BASELINE_DAYS, 30.0), **year})
    row = row_for(result, 2023)
    assert row["observation_count"] == 355 and row["expected_count"] == 365
    assert row["annual_mean_daily_max_c"] == 30.0  # zero-filling would give about 29.18
    assert row["status"] == COMPLETE and row["anomaly_c"] == 0.0
    assert "analysis_missing_days:10" in result["data_quality"]["warnings"]
    assert result["data_quality"]["missing_day_count"] == 10
    assert result["data_quality"]["analysis_coverage"] == round(355 / 365, 4)


def test_low_coverage_year_reports_mean_but_withholds_anomaly():
    year = const(year_days(2023), 33.0)
    for d in year_days(2023)[:120]:
        del year[d]
    result = analyze({**const(BASELINE_DAYS, 30.0), **year})
    row = row_for(result, 2023)
    assert row["status"] == LOW_COVERAGE and row["anomaly_c"] is None
    assert row["annual_mean_daily_max_c"] == 33.0 and row["warnings"] == ["low_coverage"]
    assert result["summary"]["complete_years"] == 0 and result["summary"]["mean_anomaly_c"] is None
    assert "years_without_anomaly:1" in result["data_quality"]["warnings"]


def test_year_without_any_observation_is_no_data_not_zero():
    data = {**const(BASELINE_DAYS, 30.0), **const(year_days(2023), 31.0)}  # 2022 absent
    result = analyze(data, date(2022, 1, 1), date(2023, 12, 31))
    row = row_for(result, 2022)
    assert row["status"] == NO_DATA and row["annual_mean_daily_max_c"] is None and row["anomaly_c"] is None
    assert row["observation_count"] == 0 and row["coverage"] == 0.0
    assert row_for(result, 2023)["anomaly_c"] == 1.0
    assert result["summary"]["complete_years"] == 1 and result["summary"]["years_in_window"] == 2


def test_partial_year_window_withholds_anomaly():
    data = {**const(BASELINE_DAYS, 30.0), **const(year_days(2023), 36.0)}
    result = analyze(data, date(2023, 3, 1), date(2023, 12, 31))
    row = row_for(result, 2023)
    assert row["status"] == PARTIAL_YEAR and row["anomaly_c"] is None
    assert row["expected_count"] == 306 and row["annual_mean_daily_max_c"] == 36.0


def test_window_with_no_observations_is_rejected():
    with pytest.raises(HeatwaveServiceError, match="no valid temperature observations"):
        analyze(const(BASELINE_DAYS, 30.0))


def test_non_finite_values_are_ignored():
    year = const(year_days(2023), 30.0)
    year[date(2023, 5, 1)] = float("nan")
    result = analyze({**const(BASELINE_DAYS, 30.0), **year})
    assert row_for(result, 2023)["observation_count"] == 364


# ------------------------------------------------------------------------------ completeness boundaries


@pytest.mark.parametrize("valid,ok", [(3287, True), (3286, False)])
def test_baseline_coverage_boundary_is_ninety_percent(valid, ok):
    days = BASELINE_DAYS[:valid]  # 0.9 * 3652 = 3286.8
    if ok:
        assert compute_baseline_mean(const(days, 20.0), B_START, B_END).observation_count == valid
    else:
        with pytest.raises(HeatwaveServiceError, match="insufficient valid observations") as exc:
            compute_baseline_mean(const(days, 20.0), B_START, B_END)
        assert exc.value.status_code == 422


def test_incomplete_baseline_is_a_422_not_a_fabricated_result():
    data = {**const(BASELINE_DAYS[::2], 30.0), **const(year_days(2023), 31.0)}  # 50% coverage
    with pytest.raises(HeatwaveServiceError) as exc:
        analyze(data)
    assert exc.value.status_code == 422 and "baseline" in exc.value.message


def test_baseline_year_with_low_coverage_is_flagged_but_usable():
    data = const(BASELINE_DAYS, 30.0)
    for d in year_days(2014)[:100]:
        del data[d]
    data.update(const(year_days(2023), 30.0))
    result = analyze(data)
    assert result["baseline"]["low_coverage_years"] == [2014]
    assert "baseline_year_low_coverage:2014" in result["data_quality"]["warnings"]


@pytest.mark.parametrize("valid,status", [(347, COMPLETE), (346, LOW_COVERAGE)])
def test_year_coverage_boundary_is_ninety_five_percent(valid, status):
    days = year_days(2023)[:valid]  # 0.95 * 365 = 346.75
    rows = annual_anomalies(const(days, 31.0), date(2023, 1, 1), date(2023, 12, 31), 30.0)
    assert rows[0]["status"] == status


# ------------------------------------------------------------------------------ rounding and summary


def test_rounding_policy_uses_unrounded_means():
    data = {**const(BASELINE_DAYS, 10.004), **const(year_days(2023), 10.006)}
    result = analyze(data)
    assert result["baseline"]["mean_daily_max_c"] == 10.0
    assert row_for(result, 2023)["annual_mean_daily_max_c"] == 10.01
    assert row_for(result, 2023)["anomaly_c"] == 0.0  # 0.002 unrounded, not 10.01 - 10.0 = 0.01


def test_round_temperature_normalises_negative_zero_and_none():
    assert round_temperature(None) is None
    assert math.copysign(1, round_temperature(-0.0004)) == 1
    assert round_temperature(1.2345) == 1.23


def test_summary_denominators_ties_and_counts():
    rows = [
        {"year": 2020, "status": COMPLETE, "anomaly_c": 1.0, "annual_mean_daily_max_c": 31.0},
        {"year": 2021, "status": COMPLETE, "anomaly_c": -1.0, "annual_mean_daily_max_c": 29.0},
        {"year": 2022, "status": COMPLETE, "anomaly_c": 1.0, "annual_mean_daily_max_c": 31.0},
        {"year": 2023, "status": LOW_COVERAGE, "anomaly_c": None, "annual_mean_daily_max_c": 40.0},
        {"year": 2024, "status": NO_DATA, "anomaly_c": None, "annual_mean_daily_max_c": None},
    ]
    s = summarize(rows)
    assert s["years_in_window"] == 5 and s["complete_years"] == 3
    assert s["mean_anomaly_c"] == pytest.approx(0.33, abs=0.005)  # 1/3 of complete years only
    assert s["mean_annual_daily_max_c"] == pytest.approx(30.33, abs=0.005)  # the 40.0 year is excluded
    assert (s["max_anomaly_c"], s["max_anomaly_year"]) == (1.0, 2020)  # earliest year wins a tie
    assert (s["min_anomaly_c"], s["min_anomaly_year"]) == (-1.0, 2021)
    assert (s["positive_years"], s["negative_years"], s["zero_years"]) == (2, 1, 0)


def test_summary_without_complete_years_has_nulls_not_zeros():
    s = summarize([])
    assert s["complete_years"] == 0
    assert s["mean_anomaly_c"] is None and s["max_anomaly_year"] is None and s["positive_years"] == 0


# ------------------------------------------------------------------------------ validation and reuse


@pytest.mark.parametrize("args,fragment", [
    ((95.0, 2.0, date(2023, 1, 1), date(2023, 12, 31), B_START, B_END), "latitude"),
    ((1.0, 181.0, date(2023, 1, 1), date(2023, 12, 31), B_START, B_END), "longitude"),
    ((1.0, 2.0, date(2023, 12, 31), date(2023, 1, 1), B_START, B_END), "on or before"),
    ((1.0, 2.0, date(1900, 1, 1), date(1901, 1, 1), B_START, B_END), "dates must be between"),
    ((1.0, 2.0, date(2023, 1, 1), date(2999, 1, 1), B_START, B_END), "dates must be between"),
    ((1.0, 2.0, date(2023, 1, 1), date(2023, 12, 31), 2019, 2010), "baseline_start_year"),
    ((1.0, 2.0, date(2023, 1, 1), date(2023, 12, 31), 2015, 2019), "at least"),
    ((1.0, 2.0, date(2023, 1, 1), date(2023, 12, 31), 1930, 2019), "1940"),
    ((1.0, 2.0, date(2023, 1, 1), date(2023, 12, 31), 2010, date.today().year), "baseline_end_year"),
])
def test_invalid_requests_are_rejected_before_any_ingestion(args, fragment):
    service, weather = make_service({})
    with pytest.raises(HeatwaveServiceError, match=fragment) as exc:
        service.analyze(*args)
    assert exc.value.status_code == 422 and weather.calls == []


def test_overlap_with_baseline_is_loaded_once_and_flagged():
    data = {**const(BASELINE_DAYS, 30.0), **const(span(date(2020, 1, 1), date(2023, 12, 31)), 31.0)}
    data.update(const(year_days(2015), 32.0))
    service, weather = make_service(data)
    result = service.analyze(1.0, 2.0, date(2015, 1, 1), date(2023, 12, 31), B_START, B_END)
    assert len(weather.calls) == len(set(weather.calls)) == 14  # 10 baseline years + 2020..2023, none twice
    assert "analysis_overlaps_baseline" in result["data_quality"]["warnings"]
    assert row_for(result, 2015)["annual_mean_daily_max_c"] == 32.0  # served from the baseline load
    assert row_for(result, 2016)["annual_mean_daily_max_c"] == 30.0
    assert row_for(result, 2021)["anomaly_c"] == pytest.approx(31.0 - result["baseline"]["mean_daily_max_c"], abs=0.01)


def test_window_before_and_after_baseline_loads_both_sides():
    data = {**const(BASELINE_DAYS, 30.0), **const(year_days(2008), 28.0), **const(year_days(2022), 33.0)}
    service, weather = make_service(data)
    result = service.analyze(1.0, 2.0, date(2008, 1, 1), date(2022, 12, 31), B_START, B_END)
    assert [r["year"] for r in result["annual"]] == list(range(2008, 2023))
    assert row_for(result, 2008)["anomaly_c"] == pytest.approx(-2.0, abs=0.2)
    assert row_for(result, 2009)["status"] == NO_DATA and row_for(result, 2022)["annual_mean_daily_max_c"] == 33.0
    assert len(weather.calls) == len(set(weather.calls))


def test_repeated_requests_give_identical_results():
    data = {**const(BASELINE_DAYS, 30.0), **const(year_days(2023), 31.5)}
    first, second = analyze(data), analyze(data)
    first.pop("computed_at"), second.pop("computed_at")
    assert first == second


def test_result_matches_the_response_schema():
    result = analyze({**const(BASELINE_DAYS, 30.0), **const(year_days(2023), 31.0)})
    parsed = TemperatureAnomalyResponse.model_validate(result)
    assert parsed.analysis_type == "temperature_anomaly" and parsed.method.method_version == "temperature-anomaly-v1"
    assert parsed.annual[0].status == "complete"
    assert set(result) == {"location_key", "analysis_type", "latitude", "longitude", "start_date", "end_date",
                           "method", "baseline", "annual", "summary", "data_quality", "source", "computed_at"}


def test_observations_outside_the_window_are_ignored():
    data = {**const(BASELINE_DAYS, 30.0), **const(span(date(2023, 1, 1), date(2023, 1, 31)), 31.0),
            date(2023, 2, 1): 99.0}
    result = analyze(data, date(2023, 1, 1), date(2023, 1, 31))
    assert row_for(result, 2023)["observation_count"] == 31 and row_for(result, 2023)["annual_mean_daily_max_c"] == 31.0
