"""Trend unit tests: no MongoDB, no network. All data are synthetic."""
import json
import math
from datetime import date
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from scipy import stats

from app.config import Settings
from app.schemas.analysis import HeatwaveAnalysisResponse
from app.schemas.trend import TrendAnalysis
from app.services.heatwave_service import HeatwaveService, HeatwaveServiceError
from app.services.trend_service import (
    TrendServiceError,
    compute_trends,
    linear_trend,
    rolling_average,
    validate_rolling_window,
)
from tests.trend_helpers import SPELLS, series, span


def row(year, count=0, days=0, mean_dur=None, max_int=None, mean_int=None, complete=True):
    return {
        "year": year, "days_expected": 365, "days_observed": 365, "coverage": 1.0, "is_complete": complete,
        "heatwave_count": count, "total_heatwave_days": days, "mean_duration_days": mean_dur,
        "max_duration_days": None, "max_intensity_c": max_int, "mean_intensity_c": mean_int,
        "peak_temperature_c": None,
    }


def metric(result, name):
    return next(m for m in result["metrics"] if m["metric"] == name)


# ---------------------------------------------------------------- regression


def test_perfect_increasing_line():
    years = list(range(2000, 2010))
    values = [2 + 0.5 * (y - 2000) for y in years]
    fit = linear_trend(years, values)
    assert fit["slope_per_year"] == pytest.approx(0.5)
    assert fit["slope_per_decade"] == pytest.approx(5.0)
    assert fit["intercept"] == pytest.approx(2 - 0.5 * 2000)
    assert fit["r_squared"] == pytest.approx(1.0)
    assert fit["p_value"] < 1e-10 and fit["p_value_supported"]
    assert fit["classification"] == "increasing"


def test_perfect_decreasing_line():
    years = list(range(2000, 2008))
    fit = linear_trend(years, [10 - 0.25 * (y - 2000) for y in years])
    assert fit["slope_per_year"] == pytest.approx(-0.25)
    assert fit["classification"] == "decreasing"


def test_known_textbook_dataset():
    # x = 1..5, y = 2,4,5,4,5: slope 0.6, intercept 2.2, r^2 0.6, t = 2.1213 on 3 df, p = 0.1240.
    years = [2001, 2002, 2003, 2004, 2005]
    fit = linear_trend(years, [2, 4, 5, 4, 5])
    assert fit["slope_per_year"] == pytest.approx(0.6)
    assert fit["intercept"] == pytest.approx(2.2 - 0.6 * 2000)
    assert fit["r_squared"] == pytest.approx(0.6)
    assert fit["p_value"] == pytest.approx(0.1240, abs=5e-4)
    assert fit["std_err"] == pytest.approx(0.6 / 2.1213203, rel=1e-5)
    assert fit["classification"] == "no_significant_trend"
    assert "low_statistical_power" in fit["notes"]


def test_matches_independent_least_squares_and_t_test():
    rng = np.random.default_rng(42)
    years = list(range(1990, 2024))
    values = list(0.08 * (np.array(years) - 1990) + rng.normal(0, 1.0, len(years)))
    fit = linear_trend(years, values)
    slope, intercept = np.polyfit(years, values, 1)
    r = np.corrcoef(years, values)[0, 1]
    t = r * math.sqrt(len(years) - 2) / math.sqrt(1 - r * r)
    assert fit["slope_per_year"] == pytest.approx(slope)
    assert fit["intercept"] == pytest.approx(intercept, rel=1e-6)
    assert fit["r_squared"] == pytest.approx(r * r)
    assert fit["p_value"] == pytest.approx(2 * stats.t.sf(abs(t), len(years) - 2))


def test_alpha_controls_classification():
    years = [2001, 2002, 2003, 2004, 2005]
    values = [2, 4, 5, 4, 5]  # p = 0.124
    assert linear_trend(years, values, alpha=0.05)["classification"] == "no_significant_trend"
    assert linear_trend(years, values, alpha=0.2)["classification"] == "increasing"


def test_constant_series_has_zero_slope_and_no_p_value():
    for constant in (0, 0.0, 3, 2.5):
        fit = linear_trend([2000, 2001, 2002, 2003], [constant] * 4)
        assert fit["slope_per_year"] == 0.0 and fit["slope_per_decade"] == 0.0
        assert fit["intercept"] == constant
        assert fit["r_squared"] is None and fit["p_value"] is None and not fit["p_value_supported"]
        assert fit["classification"] == "no_significant_trend"
        assert fit["notes"] == ["constant_series"]


def test_fewer_than_three_observations_is_insufficient():
    for n in (0, 1, 2):
        fit = linear_trend(list(range(2000, 2000 + n)), [1.0, 5.0][:n])
        assert fit["classification"] == "insufficient_data"
        assert all(fit[k] is None for k in ("slope_per_year", "slope_per_decade", "intercept", "r_squared", "p_value"))
        assert fit["notes"] == ["fewer_than_min_observations"]
    assert linear_trend([2000, 2001, 2002], [1, 2, 4])["classification"] != "insufficient_data"


def test_min_observations_cannot_be_configured_below_three():
    assert linear_trend([2000, 2001], [1, 2], min_observations=1)["classification"] == "insufficient_data"
    assert linear_trend(list(range(2000, 2004)), [1, 2, 4, 8], min_observations=5)["classification"] == "insufficient_data"


def test_irregular_spacing_uses_real_years_not_positions():
    years = [2000, 2001, 2005, 2010, 2011]
    fit = linear_trend(years, [0.5 * (y - 2000) for y in years])
    assert fit["slope_per_year"] == pytest.approx(0.5)  # an index-based fit would give a different slope
    assert fit["r_squared"] == pytest.approx(1.0)


def test_invalid_inputs_raise():
    with pytest.raises(TrendServiceError):
        linear_trend([2000, 2000, 2001], [1, 2, 3])
    with pytest.raises(TrendServiceError):
        linear_trend([2000, 2001], [1])


# ---------------------------------------------------------------- rolling average


def test_rolling_average_consecutive_years():
    values = {2000 + i: float(i + 1) for i in range(8)}  # 1..8
    result = rolling_average(values, 2000, 2007, 5)
    by_year = {p["year"]: p for p in result["points"]}
    assert [by_year[y]["status"] for y in range(2000, 2004)] == ["insufficient_history"] * 4
    assert [by_year[y]["rolling_mean"] for y in range(2000, 2004)] == [None] * 4
    assert [by_year[y]["rolling_mean"] for y in range(2004, 2008)] == [3.0, 4.0, 5.0, 6.0]
    assert result["valid_points"] == 4 and result["window_years"] == 5 and result["alignment"] == "trailing"


def test_rolling_average_does_not_bridge_gaps():
    values = {y: float(y - 2000) for y in range(2000, 2011) if y != 2003}
    points = {p["year"]: p for p in rolling_average(values, 2000, 2010, 5)["points"]}
    assert points[2003]["status"] == "year_unavailable" and points[2003]["included"] is False
    assert points[2003]["value"] is None
    for year in range(2004, 2008):  # every window that would span 2003
        assert points[year]["status"] == "gap_in_window"
        assert points[year]["rolling_mean"] is None
        assert points[year]["gap_years"] == [2003]
    assert points[2008]["status"] == "ok"
    assert points[2008]["rolling_mean"] == pytest.approx(np.mean([4, 5, 6, 7, 8]))
    assert points[2010]["rolling_mean"] == pytest.approx(np.mean([6, 7, 8, 9, 10]))


def test_rolling_average_window_longer_than_series():
    result = rolling_average({2000: 1.0, 2001: 2.0, 2002: 3.0}, 2000, 2002, 5)
    assert result["valid_points"] == 0
    assert {p["status"] for p in result["points"]} == {"insufficient_history"}
    assert all(p["rolling_mean"] is None for p in result["points"])


def test_rolling_average_keeps_zeros():
    result = rolling_average({y: 0.0 for y in range(2000, 2006)}, 2000, 2005, 5)
    ok = [p for p in result["points"] if p["status"] == "ok"]
    assert [p["rolling_mean"] for p in ok] == [0.0, 0.0]
    assert all(p["value"] == 0.0 and p["included"] for p in result["points"])


def test_rolling_average_custom_window():
    result = rolling_average({2000: 1.0, 2001: 3.0, 2002: 5.0}, 2000, 2002, 2)
    assert [p["rolling_mean"] for p in result["points"]] == [None, 2.0, 4.0]


def test_rolling_window_validation():
    assert validate_rolling_window(5) == 5
    for bad in (1, 0, -3, 31, 5.0, "5", True, None):
        with pytest.raises(TrendServiceError):
            validate_rolling_window(bad)


# ---------------------------------------------------------------- compute_trends


def linear_rows(counts, first=2000):
    return [row(first + i, count=c, days=2 * c, mean_dur=2.0 if c else None,
                max_int=float(c) if c else None, mean_int=1.0 if c else None) for i, c in enumerate(counts)]


def test_all_five_metrics_are_reported():
    result = compute_trends(linear_rows([0, 1, 2, 3, 4, 5]))
    assert [m["metric"] for m in result["metrics"]] == [
        "heatwave_frequency", "total_heatwave_days", "mean_duration_days", "max_intensity_c", "mean_intensity_c"]
    freq = metric(result, "heatwave_frequency")
    assert freq["slope_per_year"] == pytest.approx(1.0) and freq["slope_per_decade"] == pytest.approx(10.0)
    assert freq["r_squared"] == pytest.approx(1.0)
    assert freq["n_observations"] == 6 and freq["first_year"] == 2000 and freq["last_year"] == 2005
    assert metric(result, "total_heatwave_days")["slope_per_year"] == pytest.approx(2.0)
    assert len(result["insights"]) == 5


def test_incomplete_years_are_excluded_from_statistics():
    rows = linear_rows([0, 1, 2, 3, 4, 5])
    rows.append(row(2006, count=500, days=1000, complete=False))  # would wreck the fit if used
    rows[2]["is_complete"] = False
    rows[2]["heatwave_count"] = 99
    result = compute_trends(rows)
    freq = metric(result, "heatwave_frequency")
    assert freq["years_used"] == [2000, 2001, 2003, 2004, 2005]
    assert freq["excluded_incomplete_years"] == [2002, 2006]
    assert freq["n_observations"] == 5 and freq["last_year"] == 2005
    assert freq["slope_per_year"] == pytest.approx(np.polyfit([2000, 2001, 2003, 2004, 2005], [0, 1, 3, 4, 5], 1)[0])
    assert freq["slope_per_year"] == pytest.approx(1.0)
    assert freq["irregular_spacing"] and "irregular_year_spacing" in freq["notes"]
    assert "incomplete_years_excluded" in freq["notes"] and "incomplete_years_excluded" in result["warnings"]
    assert result["complete_years_used"] == 5 and result["last_complete_year"] == 2005


def test_is_complete_must_be_exactly_true():
    rows = linear_rows([0, 1, 2, 3])
    rows[0]["is_complete"] = None
    rows[1]["is_complete"] = "yes"
    result = compute_trends(rows)
    assert result["complete_years_used"] == 2
    assert result["warnings"].count("fewer_than_3_complete_years") == 1


def test_zero_event_years_are_retained_for_count_metrics():
    result = compute_trends(linear_rows([0, 0, 1, 2, 3, 4]))
    freq, days = metric(result, "heatwave_frequency"), metric(result, "total_heatwave_days")
    for m in (freq, days):
        assert m["n_observations"] == 6
        assert m["years_used"] == [2000, 2001, 2002, 2003, 2004, 2005]
        assert m["zero_value_observations"] == 2
        assert m["missing_value_years"] == []
    expected = np.polyfit(range(2000, 2006), [0, 0, 1, 2, 3, 4], 1)[0]
    assert freq["slope_per_year"] == pytest.approx(expected)
    points = {p["year"]: p for p in freq["rolling_average"]["points"]}
    assert points[2000]["value"] == 0.0 and points[2000]["included"] is True


def test_all_zero_years_are_a_constant_zero_series_not_missing():
    result = compute_trends(linear_rows([0] * 6))
    freq = metric(result, "heatwave_frequency")
    assert freq["n_observations"] == 6 and freq["zero_value_observations"] == 6
    assert freq["classification"] == "no_significant_trend" and freq["notes"] == ["constant_series"]
    assert freq["p_value"] is None and freq["slope_per_year"] == 0.0
    ok = [p for p in freq["rolling_average"]["points"] if p["status"] == "ok"]
    assert [p["rolling_mean"] for p in ok] == [0.0, 0.0]
    # Event-derived metrics have no values at all: missing, not zero.
    mean_duration = metric(result, "mean_duration_days")
    assert mean_duration["n_observations"] == 0 and mean_duration["classification"] == "insufficient_data"
    assert mean_duration["missing_value_years"] == list(range(2000, 2006))
    assert mean_duration["zero_value_observations"] == 0


def test_missing_event_metrics_are_excluded_not_treated_as_zero():
    rows = [row(2000), row(2001, 1, 3, 3.0, 1.0, 0.5), row(2002, 1, 4, 4.0, 2.0, 1.0),
            row(2003, 2, 8, 5.0, 3.0, 1.5), row(2004, 2, 10, 6.0, 4.0, 2.0)]
    result = compute_trends(rows)
    dur = metric(result, "mean_duration_days")
    assert dur["years_used"] == [2001, 2002, 2003, 2004] and dur["missing_value_years"] == [2000]
    assert dur["slope_per_year"] == pytest.approx(1.0)  # would be ~1.2 if 2000 were counted as zero
    assert "event_years_only" in dur["notes"]
    points = {p["year"]: p for p in dur["rolling_average"]["points"]}
    assert points[2000]["value"] is None and points[2000]["status"] == "year_unavailable"
    assert dur["irregular_spacing"] is False
    assert metric(result, "heatwave_frequency")["years_used"] == [2000, 2001, 2002, 2003, 2004]


def test_missing_count_value_is_not_confused_with_zero():
    rows = linear_rows([0, 1, 2, 3, 4])
    rows[0]["heatwave_count"] = None
    rows[1]["heatwave_count"] = float("nan")
    freq = metric(compute_trends(rows), "heatwave_frequency")
    assert freq["years_used"] == [2002, 2003, 2004] and freq["missing_value_years"] == [2000, 2001]
    assert freq["zero_value_observations"] == 0
    assert "missing_metric_values_excluded" in freq["notes"]


def test_fewer_than_three_complete_years_is_insufficient():
    for n in (0, 1, 2):
        result = compute_trends(linear_rows(list(range(n))))
        assert all(m["classification"] == "insufficient_data" for m in result["metrics"])
        assert "fewer_than_3_complete_years" in result["warnings"]
        assert all("insufficient data" in i["statement"] for i in result["insights"])
    result = compute_trends(linear_rows([0, 1, 2]) + [row(2003, complete=False), row(2004, complete=False)])
    freq = metric(result, "heatwave_frequency")
    assert result["complete_years_used"] == 3 and freq["n_observations"] == 3
    assert freq["p_value_supported"] and "low_statistical_power" in freq["notes"]


def test_no_rows():
    result = compute_trends([])
    assert result["complete_years_used"] == 0 and result["first_complete_year"] is None
    assert all(m["rolling_average"]["points"] == [] for m in result["metrics"])


def test_insufficient_data_for_rolling_average_still_gives_regression():
    result = compute_trends(linear_rows([0, 1, 2, 4]))  # 4 complete years < default window of 5
    freq = metric(result, "heatwave_frequency")
    assert freq["rolling_average"]["valid_points"] == 0
    assert {p["status"] for p in freq["rolling_average"]["points"]} == {"insufficient_history"}
    assert freq["classification"] != "insufficient_data" and freq["p_value_supported"]


def test_rolling_window_is_configurable_and_does_not_bridge_excluded_years():
    rows = linear_rows([1, 2, 3, 4, 5, 6, 7, 8])
    rows[3]["is_complete"] = False  # 2003 excluded
    freq5 = metric(compute_trends(rows), "heatwave_frequency")
    assert freq5["rolling_average"]["window_years"] == 5
    statuses = {p["year"]: p["status"] for p in freq5["rolling_average"]["points"]}
    assert statuses[2003] == "year_unavailable"
    assert all(statuses[y] == "gap_in_window" for y in (2004, 2005, 2006, 2007))
    freq2 = metric(compute_trends(rows, rolling_window_years=2), "heatwave_frequency")
    means = {p["year"]: p["rolling_mean"] for p in freq2["rolling_average"]["points"]}
    assert means[2002] == 2.5 and means[2003] is None and means[2004] is None and means[2005] == 5.5


def test_classification_labels_and_cautious_language():
    rng = np.random.default_rng(7)
    noisy = [int(round(x)) for x in rng.normal(3, 0.5, 15)]
    result = compute_trends(linear_rows(noisy))
    assert metric(result, "heatwave_frequency")["classification"] in ("no_significant_trend", "increasing", "decreasing")
    rising = compute_trends(linear_rows([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
    falling = compute_trends(linear_rows([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]))
    assert metric(rising, "heatwave_frequency")["classification"] == "increasing"
    assert metric(falling, "heatwave_frequency")["classification"] == "decreasing"
    for out in (rising, falling, result):
        text = " ".join(i["statement"] for i in out["insights"]) + out["interpretation_note"]
        assert "caused by" not in text and "proves" not in text and "due to climate change" not in text
        assert "does not" in out["interpretation_note"]
    assert all("does not establish its cause" in i["statement"] for i in rising["insights"] if i["classification"] == "increasing")
    flat = next(i for i in result["insights"] if i["classification"] == "no_significant_trend")
    assert "does not show that no change occurred" in flat["statement"]


def test_significance_requires_p_below_alpha():
    rows = linear_rows([2, 4, 5, 4, 5])  # p = 0.124
    assert metric(compute_trends(rows), "heatwave_frequency")["classification"] == "no_significant_trend"
    assert metric(compute_trends(rows, alpha=0.2), "heatwave_frequency")["classification"] == "increasing"
    with pytest.raises(TrendServiceError):
        compute_trends(rows, alpha=0)


def test_duplicate_year_rows_rejected():
    with pytest.raises(TrendServiceError):
        compute_trends([row(2000), row(2000)])


def test_result_is_deterministic_json_serializable_and_matches_schema():
    rows = linear_rows([0, 1, 1, 3, 2, 5, 4, 7])
    rows[2]["is_complete"] = False
    a, b = compute_trends(rows), compute_trends(rows)
    assert a == b
    text = json.dumps(a, allow_nan=False, sort_keys=True)
    assert text == json.dumps(b, allow_nan=False, sort_keys=True)
    assert TrendAnalysis.model_validate(json.loads(text)).method.method_version == "trend-v1"
    # no numpy scalars leak out
    assert type(metric(a, "heatwave_frequency")["slope_per_year"]) is float
    assert type(metric(a, "heatwave_frequency")["n_observations"]) is int


def test_negative_zero_is_normalised():
    result = compute_trends(linear_rows([3, 3, 3, 3]))
    assert str(metric(result, "heatwave_frequency")["slope_per_year"]) == "0.0"


def test_extra_warnings_are_merged():
    result = compute_trends(linear_rows([0, 1, 2, 3]), extra_warnings=["analysis_overlaps_baseline"])
    assert "analysis_overlaps_baseline" in result["warnings"]
    assert result["warnings"] == sorted(result["warnings"])


# ---------------------------------------------------------------- HeatwaveService integration (no DB)


class FakeWeather:
    def __init__(self, data):
        self.data = data
        self.calls = []

    def ingest(self, latitude, longitude, start, end):
        self.calls.append((start, end))
        days = span(start, end)
        return {
            "records": [{"date": d, "temperature_max_c": self.data[d]} for d in days if d in self.data],
            "missing_dates": sorted(d for d in days if d not in self.data),
            "warnings": [],
        }


def make_service(end=date(2024, 12, 31), spells=SPELLS, settings=None):
    weather = FakeWeather(series(date(2010, 1, 1), end, spells))
    return HeatwaveService(MagicMock(), settings or Settings(), weather), weather


def analyze(service, start=date(2020, 1, 1), end=date(2024, 12, 31), window=None):
    return service.analyze(1, 2, start, end, 2010, 2019, window)


def test_service_trend_on_known_synthetic_dataset():
    result = analyze(make_service()[0])
    assert [r["heatwave_count"] for r in result["annual"]] == [0, 1, 2, 3, 4]
    freq = metric(result["trend"], "heatwave_frequency")
    assert freq["slope_per_year"] == pytest.approx(1.0) and freq["r_squared"] == pytest.approx(1.0)
    assert freq["classification"] == "increasing" and freq["years_used"] == [2020, 2021, 2022, 2023, 2024]
    assert freq["zero_value_observations"] == 1  # 2020 has no events and is kept
    totals = metric(result["trend"], "total_heatwave_days")
    assert totals["slope_per_year"] == pytest.approx(np.polyfit(range(2020, 2025), [0, 3, 7, 12, 18], 1)[0])
    duration = metric(result["trend"], "mean_duration_days")
    assert duration["years_used"] == [2021, 2022, 2023, 2024] and duration["missing_value_years"] == [2020]
    assert duration["slope_per_year"] == pytest.approx(0.5)
    assert freq["rolling_average"]["valid_points"] == 1
    assert freq["rolling_average"]["points"][-1]["rolling_mean"] == pytest.approx(2.0)


def test_service_excludes_partial_year_from_trend():
    spells = {**SPELLS, 2025: [3] * 6}
    service, _ = make_service(date(2025, 6, 30), spells)
    result = analyze(service, end=date(2025, 6, 30))
    assert result["annual"][-1]["year"] == 2025 and result["annual"][-1]["is_complete"] is False
    assert result["annual"][-1]["heatwave_count"] == 6
    freq = metric(result["trend"], "heatwave_frequency")
    assert 2025 not in freq["years_used"] and freq["excluded_incomplete_years"] == [2025]
    assert freq["slope_per_year"] == pytest.approx(1.0)
    assert result["trend"]["last_complete_year"] == 2024


def test_service_rolling_window_parameter():
    service, _ = make_service()
    default = analyze(service)["trend"]
    assert default["method"]["rolling_window_years"] == 5
    custom = analyze(service, window=3)["trend"]
    assert custom["method"]["rolling_window_years"] == 3
    assert metric(custom, "heatwave_frequency")["rolling_average"]["valid_points"] == 3
    assert analyze(HeatwaveService(MagicMock(), Settings(trend_rolling_window_years=4), service.weather))[
        "trend"]["method"]["rolling_window_years"] == 4


def test_service_rejects_bad_rolling_window_before_loading_data():
    service, weather = make_service()
    for bad in (1, 0, 31, -1):
        with pytest.raises(HeatwaveServiceError) as exc:
            analyze(service, window=bad)
        assert exc.value.status_code == 422
    assert weather.calls == []


def test_service_trend_is_deterministic_and_serializable():
    service, _ = make_service()
    runs = [analyze(service) for _ in range(2)]
    assert runs[0]["trend"] == runs[1]["trend"]
    json.dumps(runs[0]["trend"], allow_nan=False)


def test_service_overlap_warning_reaches_trend():
    service, _ = make_service()
    result = service.analyze(1, 2, date(2015, 1, 1), date(2024, 12, 31), 2010, 2019)
    assert "analysis_overlaps_baseline" in result["trend"]["warnings"]


def test_service_with_single_year_window_is_insufficient_not_an_error():
    result = analyze(make_service()[0], date(2023, 1, 1), date(2023, 12, 31))
    assert all(m["classification"] == "insufficient_data" for m in result["trend"]["metrics"])
    assert "fewer_than_3_complete_years" in result["trend"]["warnings"]


# ---------------------------------------------------------------- API compatibility


def test_response_schema_includes_trend_and_old_payloads_still_validate():
    result = analyze(make_service()[0])
    parsed = HeatwaveAnalysisResponse.model_validate(result)
    assert parsed.trend is not None and parsed.trend.metrics[0].metric == "heatwave_frequency"
    legacy = {k: v for k, v in result.items() if k != "trend"}
    assert HeatwaveAnalysisResponse.model_validate(legacy).trend is None
    # every pre-Phase-5 top-level field is still present
    assert {"location_key", "analysis_type", "method", "params_hash", "baseline", "events", "annual", "summary",
            "data_quality", "source", "computed_at"} <= set(result)


def test_endpoint_passes_rolling_window_and_returns_trend():
    from app.main import app

    result = analyze(make_service()[0])
    with patch("app.routers.analysis.HeatwaveService") as service_cls:
        service_cls.return_value.analyze.return_value = result
        client = TestClient(app)  # no lifespan: no database needed
        base = {"latitude": 1, "longitude": 2, "start_date": "2020-01-01", "end_date": "2024-12-31"}
        response = client.get("/api/heatwaves", params={**base, "rolling_window_years": 3})
        assert response.status_code == 200
        body = response.json()
        assert body["trend"]["metrics"][0]["metric"] == "heatwave_frequency"
        assert body["summary"]["total_events"] == 10 and body["annual"][0]["heatwave_count"] == 0
        assert service_cls.return_value.analyze.call_args.args[-1] == 3
        client.get("/api/heatwaves", params=base)
        assert service_cls.return_value.analyze.call_args.args[-1] is None


def test_endpoint_rejects_out_of_range_rolling_window():
    from app.main import app

    client = TestClient(app)
    base = {"latitude": 1, "longitude": 2, "start_date": "2020-01-01", "end_date": "2024-12-31"}
    for bad in (1, 31, "abc"):
        assert client.get("/api/heatwaves", params={**base, "rolling_window_years": bad}).status_code == 422


def test_endpoint_function_still_callable_without_rolling_window():
    from app.routers.analysis import get_heatwaves

    result = analyze(make_service()[0])
    with patch("app.routers.analysis.HeatwaveService") as service_cls:
        service_cls.return_value.analyze.return_value = result
        response = get_heatwaves(1, 2, date(2020, 1, 1), date(2024, 12, 31), None, None)
    assert HeatwaveAnalysisResponse.model_validate(response).trend is not None
    with patch("app.routers.analysis.HeatwaveService") as service_cls:
        service_cls.return_value.analyze.side_effect = HeatwaveServiceError("bad window", 422)
        with pytest.raises(HTTPException) as exc:
            get_heatwaves(1, 2, date(2020, 1, 1), date(2024, 12, 31), None, None, 99)
    assert exc.value.status_code == 422
