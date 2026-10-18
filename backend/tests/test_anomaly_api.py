"""GET /api/temperature-anomalies at the HTTP layer: validation, error mapping, rate limiting. No database."""
from datetime import date, datetime, timezone

import pytest

from app.routers import anomaly as anomaly_router
from app.services.anomaly_service import AnomalyService
from app.services.heatwave_service import HeatwaveServiceError
from app.services.weather_service import WeatherServiceError

PATH = "/api/temperature-anomalies"
GOOD = {"latitude": 28.6139, "longitude": 77.2090, "start_date": "2023-01-01", "end_date": "2023-12-31"}
BAD = {**GOOD, "latitude": 999}  # rejected by validation: no database or upstream access


def fake_result():
    return {
        "location_key": "28.613900,77.209000", "analysis_type": "temperature_anomaly",
        "latitude": 28.6139, "longitude": 77.209, "start_date": date(2023, 1, 1), "end_date": date(2023, 12, 31),
        "method": {
            "method_version": "temperature-anomaly-v1", "metric": "m", "baseline_statistic": "b",
            "anomaly_formula": "f", "unit": "celsius", "temperature_decimals": 2, "coverage_decimals": 4,
            "baseline_min_coverage": 0.9, "year_min_coverage": 0.95, "missing_value_policy": "p",
            "incomplete_year_policy": "q",
        },
        "baseline": {"start_year": 1991, "end_year": 2020, "mean_daily_max_c": 30.8, "observation_count": 10958,
                     "expected_count": 10958, "coverage": 1.0, "low_coverage_years": []},
        "annual": [{"year": 2023, "annual_mean_daily_max_c": 32.4, "anomaly_c": 1.6, "observation_count": 365,
                    "expected_count": 365, "coverage": 1.0, "status": "complete", "warnings": []}],
        "summary": {"years_in_window": 1, "complete_years": 1, "mean_anomaly_c": 1.6, "mean_annual_daily_max_c": 32.4,
                    "max_anomaly_c": 1.6, "max_anomaly_year": 2023, "min_anomaly_c": 1.6, "min_anomaly_year": 2023,
                    "positive_years": 1, "negative_years": 0, "zero_years": 0},
        "data_quality": {"analysis_coverage": 1.0, "missing_day_count": 0, "warnings": []},
        "source": "open-meteo-archive", "computed_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "internal_field_that_must_not_leak": "x",
    }


def test_success_response_is_filtered_through_the_schema(make_client, monkeypatch):
    monkeypatch.setattr(AnomalyService, "analyze", lambda self, *a: fake_result())
    response = make_client().get(PATH, params=GOOD)
    assert response.status_code == 200
    body = response.json()
    assert body["annual"][0]["anomaly_c"] == 1.6 and body["baseline"]["mean_daily_max_c"] == 30.8
    assert "internal_field_that_must_not_leak" not in body


def test_optional_baseline_years_are_forwarded(make_client, monkeypatch):
    seen = {}
    monkeypatch.setattr(AnomalyService, "analyze", lambda self, *a: seen.setdefault("args", a) and fake_result())
    make_client().get(PATH, params={**GOOD, "baseline_start_year": 2000, "baseline_end_year": 2015})
    assert seen["args"][-2:] == (2000, 2015)
    seen.clear()
    make_client().get(PATH, params=GOOD)
    assert seen["args"][-2:] == (None, None)


@pytest.mark.parametrize("override", [
    {"latitude": "nan"}, {"latitude": "-91"}, {"longitude": "181"}, {"longitude": "abc"},
    {"start_date": "2023-13-45"}, {"end_date": "20231231"}, {"latitude": ""},
    {"baseline_start_year": 1800}, {"baseline_end_year": "x"},
])
def test_invalid_query_values_are_rejected_with_consistent_json(make_client, override):
    response = make_client().get(PATH, params={**GOOD, **override})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error"] == "Invalid request parameters" and detail["errors"]
    assert all(set(e) == {"field", "message"} for e in detail["errors"])


def test_missing_parameters_are_reported_per_field(make_client):
    response = make_client().get(PATH)
    assert response.status_code == 422
    assert {e["field"] for e in response.json()["detail"]["errors"]} == set(GOOD)


@pytest.mark.parametrize("override,fragment", [
    ({"start_date": "2023-12-31", "end_date": "2023-01-01"}, "on or before"),
    ({"start_date": "1900-01-01", "end_date": "1900-12-31"}, "dates must be between"),
    ({"start_date": "2999-01-01", "end_date": "2999-02-01"}, "dates must be between"),
    ({"baseline_start_year": 2015, "baseline_end_year": 2019}, "at least"),
])
def test_service_validation_errors_are_json_422(make_client, override, fragment):
    response = make_client().get(PATH, params={**GOOD, **override})
    assert response.status_code == 422
    assert fragment in response.json()["detail"]["error"]


@pytest.mark.parametrize("error,status,message", [
    (HeatwaveServiceError("baseline period has insufficient valid observations", 422), 422,
     "baseline period has insufficient valid observations"),
    (WeatherServiceError("Open-Meteo request timed out", 504), 504, "Open-Meteo request timed out"),
    (WeatherServiceError("Open-Meteo is rate limiting requests; try again shortly", 503), 503,
     "Open-Meteo is rate limiting requests; try again shortly"),
])
def test_service_errors_map_to_their_status(make_client, monkeypatch, error, status, message):
    def boom(self, *args):
        raise error

    monkeypatch.setattr(AnomalyService, "analyze", boom)
    response = make_client().get(PATH, params=GOOD)
    assert response.status_code == status and response.json() == {"detail": {"error": message}}


def test_unexpected_errors_do_not_leak_internals(make_client, monkeypatch):
    def boom(self, *args):
        raise RuntimeError("mongodb+srv://user:secret@cluster.example/db exploded")

    monkeypatch.setattr(AnomalyService, "analyze", boom)
    response = make_client().get(PATH, params=GOOD)
    assert response.status_code == 500
    assert response.json() == {"detail": {"error": "Internal server error"}}
    assert "secret" not in response.text and "mongodb" not in response.text


def test_endpoint_has_its_own_stricter_rate_limit_bucket(make_client):
    client = make_client(rate_limit_requests_per_minute=50, rate_limit_heatwave_requests_per_minute=2)
    assert [client.get(PATH, params=BAD).status_code for _ in range(2)] == [422, 422]
    blocked = client.get(PATH, params=BAD)
    assert blocked.status_code == 429 and 1 <= int(blocked.headers["retry-after"]) <= 60
    # Separate buckets: exhausting anomalies does not consume the heatwave or generic quotas.
    assert client.get("/api/heatwaves", params=BAD).status_code == 422
    assert client.get("/api/weather", params=BAD).status_code == 422


def test_heatwave_quota_is_unaffected_by_anomaly_requests(make_client):
    client = make_client(rate_limit_requests_per_minute=50, rate_limit_heatwave_requests_per_minute=2)
    for _ in range(3):
        client.get(PATH, params=BAD)
    assert [client.get("/api/heatwaves", params=BAD).status_code for _ in range(2)] == [422, 422]
    assert client.get("/api/heatwaves", params=BAD).status_code == 429


def test_openapi_documents_the_endpoint_and_keeps_heatwaves(make_client):
    spec = make_client().get("/openapi.json").json()
    assert PATH in spec["paths"] and "/api/heatwaves" in spec["paths"]
    operation = spec["paths"][PATH]["get"]
    assert {p["name"] for p in operation["parameters"]} == {
        "latitude", "longitude", "start_date", "end_date", "baseline_start_year", "baseline_end_year"}
    schemas = spec["components"]["schemas"]
    assert {"TemperatureAnomalyResponse", "AnnualAnomaly", "AnomalyBaseline", "AnomalySummary"} <= set(schemas)
    assert "rolling_window_years" in {p["name"] for p in spec["paths"]["/api/heatwaves"]["get"]["parameters"]}


def test_router_module_exposes_one_route():
    assert [r.path for r in anomaly_router.router.routes] == [PATH]
