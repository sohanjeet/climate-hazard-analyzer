"""Heatwave unit tests: no MongoDB, no network."""
import random
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi import HTTPException

from app.config import Settings
from app.schemas.analysis import HeatwaveAnalysisResponse
from app.services.heatwave_service import (
    HeatwaveService,
    HeatwaveServiceError,
    annual_metrics,
    compute_baseline,
    detect_events,
    params_hash,
    percentile_linear,
    summarize,
    year_chunks,
)
from app.services.weather_service import WeatherServiceError

THRESHOLD = 30.0
D = date(2024, 7, 1)


def span(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def series(start, values):
    """Observations from consecutive days; None leaves the day absent."""
    return {start + timedelta(days=i): v for i, v in enumerate(values) if v is not None}


def baseline_data(start_year=2010, end_year=2019):
    return {d: 20.0 + ((d.toordinal() * 37) % 100) / 10 for d in span(date(start_year, 1, 1), date(end_year, 12, 31))}


class FakeWeather:
    """Stands in for WeatherService.ingest using a dict of observations."""

    def __init__(self, data, missing=()):
        self.data = dict(data)
        self.missing = set(missing)
        self.calls = []

    def ingest(self, latitude, longitude, start, end):
        self.calls.append((start, end))
        days = span(start, end)
        records = [{"date": d, "temperature_max_c": self.data[d]} for d in days if d in self.data]
        return {
            "records": records,
            "missing_dates": sorted(d for d in days if d not in self.data),
            "warnings": [],
        }


def make_service(data, missing=()):
    return HeatwaveService(MagicMock(), Settings(), FakeWeather(data, missing))


def analysis_data(hot_days=(), year=2023):
    data = baseline_data()
    data.update({d: 15.0 for d in span(date(year, 1, 1), date(year, 12, 31))})
    for d in hot_days:
        data[d] = 45.0
    return data


# ---------------------------------------------------------------- percentile / baseline


def test_percentile_linear_known_values():
    assert percentile_linear([1, 2, 3, 4, 5], 95) == pytest.approx(4.8)
    assert percentile_linear(range(1, 101), 95) == pytest.approx(95.05)
    assert percentile_linear([3, 1, 2], 0) == 1
    assert percentile_linear([3, 1, 2], 100) == 3
    assert percentile_linear([7], 95) == 7


def test_percentile_matches_numpy():
    rng = random.Random(42)
    values = [rng.uniform(-10, 45) for _ in range(1000)]
    assert percentile_linear(values, 95) == pytest.approx(float(np.percentile(values, 95, method="linear")))


def test_percentile_empty_raises():
    with pytest.raises(ValueError):
        percentile_linear([], 95)


def test_baseline_threshold_and_exceedance_fraction():
    data = baseline_data()
    baseline = compute_baseline(data, 2010, 2019)
    assert baseline.observation_count == baseline.expected_count == 3652
    assert baseline.threshold_c == pytest.approx(percentile_linear(list(data.values()), 95))
    assert baseline.exceedance_count / baseline.observation_count <= 0.05 + 1 / baseline.observation_count


def test_baseline_low_coverage_raises():
    data = baseline_data()
    for i, d in enumerate(sorted(data)):
        if i % 20 < 3:  # 15% missing -> 85% coverage
            del data[d]
    with pytest.raises(HeatwaveServiceError) as exc:
        compute_baseline(data, 2010, 2019)
    assert exc.value.status_code == 422


def test_baseline_low_coverage_year_warns():
    data = baseline_data()
    for i, d in enumerate(span(date(2013, 1, 1), date(2013, 12, 31))):
        if i % 5 == 0:  # 20% of 2013 missing
            del data[d]
    baseline = compute_baseline(data, 2010, 2019)
    assert baseline.low_coverage_years == [2013]
    assert baseline.coverage >= 0.90


def test_baseline_constant_values_no_exceedance():
    data = {d: 25.0 for d in span(date(2010, 1, 1), date(2019, 12, 31))}
    baseline = compute_baseline(data, 2010, 2019)
    assert baseline.threshold_c == 25.0
    assert baseline.exceedance_count == 0


# ---------------------------------------------------------------- event detection


def test_detect_basic_events():
    obs = series(D, [31, 32, 33, 29, 31, 31, 29, 35, 36, 37, 38])
    events = detect_events(obs, D, date(2024, 7, 11), THRESHOLD)
    assert len(events) == 2
    first, second = events
    assert (first.start_date, first.end_date, first.duration_days) == (date(2024, 7, 1), date(2024, 7, 3), 3)
    assert first.peak_temperature_c == 33
    assert first.max_exceedance_c == 3
    assert first.mean_exceedance_c == 2
    assert first.cumulative_exceedance_c == 6
    assert (second.start_date, second.end_date, second.duration_days) == (date(2024, 7, 8), date(2024, 7, 11), 4)
    assert second.max_exceedance_c == 8
    assert second.mean_exceedance_c == 6.5
    assert second.cumulative_exceedance_c == 26
    assert second.censored_end is True and second.censored_start is False


def test_equal_to_threshold_is_not_exceedance():
    events = detect_events(series(D, [30, 31, 32, 33]), D, date(2024, 7, 4), THRESHOLD)
    assert len(events) == 1
    assert (events[0].start_date, events[0].end_date) == (date(2024, 7, 2), date(2024, 7, 4))
    assert detect_events(series(D, [30, 30, 30]), D, date(2024, 7, 3), THRESHOLD) == []


def test_two_day_run_is_not_event():
    assert detect_events(series(D, [31, 32, 20, 31, 32, 20]), D, date(2024, 7, 6), THRESHOLD) == []


def test_missing_day_breaks_run():
    obs = series(D, [31, 31, None, 31, 31])
    assert detect_events(obs, D, date(2024, 7, 5), THRESHOLD) == []


def test_missing_day_splits_into_two_events():
    obs = series(D, [31, 31, 31, None, 31, 31, 31])
    events = detect_events(obs, D, date(2024, 7, 7), THRESHOLD)
    assert [e.duration_days for e in events] == [3, 3]
    assert all(e.adjacent_missing for e in events)


def test_detection_uses_calendar_not_record_adjacency():
    obs = {date(2024, 7, d): 35.0 for d in (1, 2, 4, 5, 6)}
    events = detect_events(obs, D, date(2024, 7, 6), THRESHOLD)
    assert len(events) == 1
    assert (events[0].start_date, events[0].end_date) == (date(2024, 7, 4), date(2024, 7, 6))


def test_long_run_is_single_event():
    events = detect_events(series(D, [35] * 10), D, date(2024, 7, 10), THRESHOLD)
    assert len(events) == 1 and events[0].duration_days == 10


def test_event_spanning_new_year():
    start = date(2023, 12, 30)
    obs = series(start, [35, 36, 37, 38])
    window = (date(2023, 12, 1), date(2024, 1, 31))
    events = detect_events(obs, *window, THRESHOLD)
    assert len(events) == 1 and events[0].year == 2023 and events[0].duration_days == 4
    annual = {row["year"]: row for row in annual_metrics(events, obs, *window)}
    assert annual[2023]["total_heatwave_days"] == 4
    assert annual[2024]["total_heatwave_days"] == 0


def test_leap_day_contiguity():
    leap = series(date(2024, 2, 28), [35, 35, 35])
    events = detect_events(leap, date(2024, 2, 20), date(2024, 3, 10), THRESHOLD)
    assert len(events) == 1 and events[0].duration_days == 3 and date(2024, 2, 29) in leap
    common = series(date(2023, 2, 27), [35, 35, 35])
    events = detect_events(common, date(2023, 2, 20), date(2023, 3, 10), THRESHOLD)
    assert len(events) == 1 and events[0].duration_days == 3


def test_window_edge_censoring():
    events = detect_events(series(D, [35, 35, 35, 20, 20]), D, date(2024, 7, 5), THRESHOLD)
    assert events[0].censored_start is True and events[0].censored_end is False
    all_hot = detect_events(series(D, [35] * 5), D, date(2024, 7, 5), THRESHOLD)
    assert len(all_hot) == 1 and all_hot[0].censored_start and all_hot[0].censored_end


# ---------------------------------------------------------------- annual metrics / summary


def test_annual_mean_intensity_is_day_weighted():
    # exceedances [1,1,1] then [3,3,3,3,3] over threshold 30
    obs = series(D, [31, 31, 31, 20, 33, 33, 33, 33, 33])
    events = detect_events(obs, D, date(2024, 7, 9), THRESHOLD)
    row = annual_metrics(events, obs, D, date(2024, 7, 9))[0]
    assert row["mean_intensity_c"] == 2.25
    assert row["max_intensity_c"] == 3
    assert row["mean_duration_days"] == 4
    assert row["heatwave_count"] == 2 and row["total_heatwave_days"] == 8


def test_annual_zero_events():
    start, end = date(2024, 1, 1), date(2024, 12, 31)
    obs = {d: 20.0 for d in span(start, end)}
    row = annual_metrics([], obs, start, end)[0]
    assert row["is_complete"] is True
    assert row["heatwave_count"] == 0 and row["total_heatwave_days"] == 0
    for key in ("mean_duration_days", "max_duration_days", "max_intensity_c", "mean_intensity_c", "peak_temperature_c"):
        assert row[key] is None


def test_partial_year_not_complete():
    start, end = date(2024, 1, 1), date(2024, 6, 30)
    obs = {d: 20.0 for d in span(start, end)}
    row = annual_metrics([], obs, start, end)[0]
    assert row["is_complete"] is False and row["days_expected"] == 182


def test_year_coverage_threshold():
    start, end = date(2024, 1, 1), date(2024, 12, 31)
    days = span(start, end)
    for missing, complete in ((18, True), (19, False)):
        obs = {d: 20.0 for d in days[missing:]}
        row = annual_metrics([], obs, start, end)[0]
        assert row["days_expected"] == 366
        assert row["is_complete"] is complete


def test_summary_rates_use_complete_years_only():
    start, end = date(2022, 1, 1), date(2024, 6, 30)
    obs = {d: 20.0 for d in span(start, end)}
    for a in (date(2022, 7, 1), date(2023, 7, 1), date(2023, 8, 1), date(2024, 5, 1)):
        for d in span(a, a + timedelta(days=2)):
            obs[d] = 35.0
    events = detect_events(obs, start, end, THRESHOLD)
    annual = annual_metrics(events, obs, start, end)
    summary = summarize(events, annual)
    assert [r["is_complete"] for r in annual] == [True, True, False]
    assert summary["total_events"] == 4 and summary["total_heatwave_days"] == 12
    assert summary["complete_years"] == 2
    assert summary["events_per_complete_year"] == 1.5
    assert summary["heatwave_days_per_complete_year"] == 4.5
    assert summarize([], annual_metrics([], obs, start, end))["mean_intensity_c"] is None


def test_year_chunks():
    assert year_chunks(date(2019, 6, 1), date(2021, 3, 31)) == [
        (date(2019, 6, 1), date(2019, 12, 31)),
        (date(2020, 1, 1), date(2020, 12, 31)),
        (date(2021, 1, 1), date(2021, 3, 31)),
    ]


def test_params_hash_is_deterministic_and_sensitive():
    args = (1991, 2020, 95.0, 3, 0.9, 0.95)
    assert params_hash(*args) == params_hash(*args)
    assert params_hash(*args) != params_hash(1991, 2020, 90.0, 3, 0.9, 0.95)


# ---------------------------------------------------------------- service


def test_threshold_independent_of_analysis_window():
    svc = make_service(analysis_data())
    a = svc.analyze(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    b = svc.analyze(1, 2, date(2023, 3, 1), date(2023, 4, 30), 2010, 2019)
    assert a["baseline"]["threshold_c"] == b["baseline"]["threshold_c"]


def test_validation_errors():
    svc = make_service({})
    ok = (1, 2, date(2023, 1, 1), date(2023, 12, 31))
    cases = [
        (ok + (2019, 2010)),
        (ok + (2015, 2019)),  # 5 years
        (ok + (2010, date.today().year)),  # end year incomplete
        (1, 2, date(2023, 12, 31), date(2023, 1, 1), 2010, 2019),
        (1, 2, date(1940, 1, 1), date(2039, 12, 31), 2010, 2019),  # > 90 years
        (1, 2, date(2023, 1, 1), date.today(), 2010, 2019),  # beyond archive lag
        (95, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019),
    ]
    for args in cases:
        with pytest.raises(HeatwaveServiceError) as exc:
            svc.validate_request(*args)
        assert exc.value.status_code == 422
    svc.validate_request(*ok, 2010, 2019)


def test_service_requires_year_sized_weather_chunks():
    with pytest.raises(RuntimeError):
        HeatwaveService(MagicMock(), Settings(weather_max_range_days=100))


def test_analyze_loads_baseline_in_year_chunks():
    weather = FakeWeather(analysis_data())
    HeatwaveService(MagicMock(), Settings(), weather).analyze(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    assert all((e - s).days <= 365 for s, e in weather.calls)
    assert len(weather.calls) == 11


def test_missing_dates_propagate_to_data_quality():
    day = date(2023, 7, 4)
    data = analysis_data(hot_days=span(date(2023, 7, 1), date(2023, 7, 7)))
    del data[day]
    result = make_service(data).analyze(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    assert result["data_quality"]["missing_dates"] == [day]
    assert "analysis_missing_days:1" in result["data_quality"]["warnings"]
    assert [e["duration_days"] for e in result["events"]] == [3, 3]
    assert all(e["adjacent_missing"] for e in result["events"])


def test_overlap_warning():
    result = make_service(analysis_data()).analyze(1, 2, date(2015, 6, 1), date(2015, 6, 30), 2010, 2019)
    assert "analysis_overlaps_baseline" in result["data_quality"]["warnings"]
    outside = make_service(analysis_data()).analyze(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    assert "analysis_overlaps_baseline" not in outside["data_quality"]["warnings"]


def test_no_analysis_observations_raises():
    with pytest.raises(HeatwaveServiceError, match="no valid temperature observations") as exc:
        make_service(baseline_data()).analyze(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    assert exc.value.status_code == 422


def test_analyze_is_deterministic():
    svc = make_service(analysis_data(hot_days=span(date(2023, 7, 1), date(2023, 7, 5))))
    runs = [svc.analyze(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019) for _ in range(2)]
    for run in runs:
        run.pop("computed_at")
    assert runs[0] == runs[1]
    assert runs[0]["summary"]["total_events"] == 1


# ---------------------------------------------------------------- endpoint


def test_heatwave_endpoint_response_schema():
    from app.routers.analysis import get_heatwaves

    result = make_service(analysis_data(hot_days=span(date(2023, 7, 1), date(2023, 7, 5)))).analyze(
        1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    with patch("app.routers.analysis.HeatwaveService") as service_cls:
        service_cls.return_value.analyze.return_value = result
        response = get_heatwaves(1, 2, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)
    parsed = HeatwaveAnalysisResponse.model_validate(response)
    assert parsed.summary.total_events == 1 and parsed.events[0].duration_days == 5
    assert parsed.method.method_version == "heatwave-v1"


def test_endpoint_maps_service_error():
    from app.routers.analysis import get_heatwaves

    for error, status in ((HeatwaveServiceError("bad", 422), 422), (WeatherServiceError("slow", 504), 504)):
        with patch("app.routers.analysis.HeatwaveService") as service_cls:
            service_cls.return_value.analyze.side_effect = error
            with pytest.raises(HTTPException) as exc:
                get_heatwaves(1, 2, date(2023, 1, 1), date(2023, 12, 31), None, None)
        assert exc.value.status_code == status
        assert exc.value.detail == {"error": error.message}
