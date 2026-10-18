"""Security regression tests: CORS, input validation, error shape, and no sensitive data in responses or logs."""
import logging
from unittest.mock import patch

import pytest
from pymongo.errors import ServerSelectionTimeoutError

from app import database
from app.config import Settings
from app.logging_config import configure_logging
from app.services.weather_service import WeatherService, WeatherServiceError

GOOD = {"latitude": 28.6139, "longitude": 77.2090, "start_date": "2023-01-01", "end_date": "2023-01-05"}
SECRET = "s3cret-pw"
ALLOWED = "http://localhost:5173"


# ----------------------------------------------------------------------------- CORS


def test_cors_origins_parsed_from_env_list():
    s = Settings(cors_allowed_origins=" https://a.example/ , http://localhost:5173,,")
    assert s.cors_origins == ["https://a.example", "http://localhost:5173"]


def test_cors_allows_only_configured_origins(make_client):
    client = make_client(cors_allowed_origins="https://app.example")
    ok = client.get("/health", headers={"Origin": "https://app.example"})
    assert ok.headers["access-control-allow-origin"] == "https://app.example"
    assert "access-control-allow-credentials" not in ok.headers
    evil = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers
    # The default localhost origin is replaced, not added to.
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": ALLOWED}).headers


def test_cors_preflight_rejects_unlisted_origin_and_methods(make_client):
    client = make_client(cors_allowed_origins=ALLOWED)
    bad_origin = client.options("/api/weather", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert bad_origin.status_code == 400
    bad_method = client.options("/api/weather", headers={"Origin": ALLOWED, "Access-Control-Request-Method": "DELETE"})
    assert bad_method.status_code == 400
    ok = client.options("/api/weather", headers={"Origin": ALLOWED, "Access-Control-Request-Method": "GET"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-methods"] == "GET"


# ----------------------------------------------------------------------------- validation


@pytest.mark.parametrize("path", ["/api/weather", "/api/heatwaves"])
@pytest.mark.parametrize("override", [
    {"latitude": "nan"}, {"latitude": "inf"}, {"latitude": "-91"}, {"longitude": "181"}, {"longitude": "abc"},
    {"start_date": "2023-13-45"}, {"start_date": "yesterday"}, {"end_date": "20230105"},
    {"latitude": ""}, {"start_date": "9" * 5000},
])
def test_invalid_query_values_are_rejected_with_consistent_json(make_client, path, override):
    client = make_client()
    response = client.get(path, params={**GOOD, **override})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error"] == "Invalid request parameters" and detail["errors"]
    for err in detail["errors"]:
        assert set(err) == {"field", "message"}


def test_missing_parameters_are_reported_per_field(make_client):
    response = make_client().get("/api/weather")
    assert response.status_code == 422
    assert {e["field"] for e in response.json()["detail"]["errors"]} == set(GOOD)


def test_rejected_input_is_not_echoed_back(make_client):
    payload = "<script>alert(1)</script>"
    response = make_client().get("/api/weather", params={**GOOD, "latitude": payload})
    assert response.status_code == 422 and payload not in response.text


@pytest.mark.parametrize("extra", [
    {"baseline_start_year": 10**30}, {"baseline_end_year": -5}, {"baseline_start_year": 1800},
    {"rolling_window_years": 1}, {"rolling_window_years": 31}, {"rolling_window_years": "x"},
])
def test_heatwave_numeric_parameters_are_bounded(make_client, extra):
    response = make_client().get("/api/heatwaves", params={**GOOD, **extra})
    assert response.status_code == 422 and "error" in response.json()["detail"]


@pytest.mark.parametrize("override,fragment", [
    ({"start_date": "2023-01-05", "end_date": "2023-01-01"}, "on or before"),
    ({"start_date": "2000-01-01", "end_date": "2023-01-01"}, "cannot exceed"),   # range longer than 366 days
    ({"start_date": "1900-01-01", "end_date": "1900-01-05"}, "dates must be between"),
    ({"start_date": "2999-01-01", "end_date": "2999-01-05"}, "dates must be between"),
])
def test_weather_date_range_rules_return_json_error(make_client, override, fragment):
    response = make_client().get("/api/weather", params={**GOOD, **override})
    assert response.status_code == 422
    assert fragment in response.json()["detail"]["error"]


def test_heatwave_date_and_baseline_rules_return_json_error(make_client):
    client = make_client()
    future = client.get("/api/heatwaves", params={**GOOD, "start_date": "2999-01-01", "end_date": "2999-02-01"})
    assert future.status_code == 422 and "dates must be between" in future.json()["detail"]["error"]
    short = client.get("/api/heatwaves", params={**GOOD, "baseline_start_year": 2015, "baseline_end_year": 2019})
    assert short.status_code == 422 and "at least" in short.json()["detail"]["error"]


def test_unknown_route_and_wrong_method_use_the_same_error_shape(make_client):
    client = make_client()
    missing = client.get("/nope")
    assert missing.status_code == 404 and missing.json() == {"detail": {"error": "Not Found"}}
    wrong = client.post("/api/weather")
    assert wrong.status_code == 405 and "error" in wrong.json()["detail"]


# ----------------------------------------------------------------------------- no leaks in responses/logs


def test_unhandled_exception_returns_generic_500_without_details(make_client, caplog):
    boom = RuntimeError(f"mongodb://user:{SECRET}@db.internal:27017 exploded")
    with patch.object(WeatherService, "ingest", side_effect=boom), caplog.at_level(logging.DEBUG):
        response = make_client(cors_allowed_origins=ALLOWED).get("/api/weather", params=GOOD, headers={"Origin": ALLOWED})
    assert response.status_code == 500
    assert response.json() == {"detail": {"error": "Internal server error"}}
    assert SECRET not in response.text and "db.internal" not in response.text
    assert SECRET not in caplog.text and "db.internal" not in caplog.text
    assert "RuntimeError" in caplog.text  # the type is still logged for debugging
    assert response.headers["access-control-allow-origin"] == ALLOWED  # browsers can read the error


def test_database_outage_returns_503_without_leaking_driver_message(make_client, caplog):
    error = ServerSelectionTimeoutError(f"db.internal:27017: timed out (uri mongodb://user:{SECRET}@db.internal)")
    with patch.object(WeatherService, "ingest", side_effect=error), caplog.at_level(logging.DEBUG):
        response = make_client().get("/api/weather", params=GOOD)
    assert response.status_code == 503
    assert response.json() == {"detail": {"error": "Database temporarily unavailable"}}
    assert response.headers["retry-after"] == "5"
    assert SECRET not in response.text + caplog.text and "db.internal" not in response.text + caplog.text


def test_requests_without_a_database_connection_return_503(make_client):
    database.close()
    response = make_client().get("/api/weather", params=GOOD)
    assert response.status_code == 503
    assert response.json()["detail"]["error"] == "Database temporarily unavailable"
    assert make_client().get("/health/db").status_code == 503
    assert make_client().get("/health").status_code == 200


def test_upstream_error_does_not_expose_url_or_coordinates(make_client):
    leaky = WeatherServiceError("Open-Meteo request failed", 502)
    with patch.object(WeatherService, "ingest", side_effect=leaky):
        response = make_client().get("/api/weather", params=GOOD)
    assert response.status_code == 502
    assert response.json() == {"detail": {"error": "Open-Meteo request failed"}}
    assert "28.6139" not in response.text and "open-meteo.com" not in response.text


def test_request_log_omits_query_string_and_coordinates(make_client, caplog):
    with patch.object(WeatherService, "ingest", side_effect=WeatherServiceError("Open-Meteo request failed", 502)):
        with caplog.at_level(logging.INFO, logger="app.request"):
            make_client().get("/api/weather", params={**GOOD, "latitude": 12.345678})
    assert "request method=GET path=/api/weather status=502 duration_ms=" in caplog.text
    assert "12.345678" not in caplog.text and "latitude" not in caplog.text and "28.6139" not in caplog.text


def test_unknown_paths_are_logged_as_unmatched_to_prevent_log_injection(make_client, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        make_client().get("/evil%0AINFO%20forged%20line")
    assert "path=unmatched" in caplog.text and "forged" not in caplog.text


def test_httpx_request_urls_are_not_logged_and_access_log_drops_query():
    configure_logging("INFO")
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("1.2.3.4:5", "GET", "/api/weather?latitude=28.6&longitude=77.2", "1.1", 200), None)
    for f in logging.getLogger("uvicorn.access").filters:
        f.filter(record)
    assert "28.6" not in record.getMessage() and "/api/weather" in record.getMessage()


def test_settings_do_not_reveal_mongodb_credentials():
    s = Settings(mongodb_uri=f"mongodb+srv://user:{SECRET}@cluster.example.net/")
    assert SECRET not in repr(s) and SECRET not in str(s.model_dump())


def test_responses_carry_security_headers_and_request_id(make_client):
    response = make_client().get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert len(response.headers["x-request-id"]) == 16
    assert make_client().get("/health").headers["x-request-id"] != response.headers["x-request-id"]
