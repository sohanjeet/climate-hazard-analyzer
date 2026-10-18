"""Anomaly service/endpoint tests against a real MongoDB (throwaway database, Open-Meteo mocked)."""
import threading
import time
from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app import database
from app.config import get_settings
from app.schemas.anomaly import TemperatureAnomalyResponse
from app.services.anomaly_service import AnomalyService
from app.services.heatwave_service import HeatwaveService
from app.services.weather_service import WeatherService
from tests.test_heatwave_integration import LAT, LON, fake_fetch, live_db  # noqa: F401 (live_db is a fixture)

pytestmark = pytest.mark.integration

WINDOW = (date(2023, 1, 1), date(2023, 12, 31))


@pytest.fixture
def weather(live_db):  # noqa: F811
    service = WeatherService(live_db)
    service._fetch = MagicMock(side_effect=fake_fetch)
    return service


def anomaly_service(live_db, weather):  # noqa: F811
    return AnomalyService(live_db, heatwave_service=HeatwaveService(live_db, weather_service=weather))


def run(live_db, weather):  # noqa: F811
    return anomaly_service(live_db, weather).analyze(LAT, LON, *WINDOW, 2010, 2019)


def test_analysis_returns_expected_shape_and_stores_no_results(live_db, weather):  # noqa: F811
    result = run(live_db, weather)
    TemperatureAnomalyResponse.model_validate(result)
    assert result["annual"][0]["status"] == "complete"
    assert result["baseline"]["observation_count"] == 3652
    # Derived on demand from weather_records: no analysis document is written.
    assert live_db[database.ANALYSIS_RESULTS].count_documents({}) == 0
    assert live_db[database.WEATHER_RECORDS].count_documents({}) == 3652 + 365


def test_second_request_reuses_stored_weather(live_db, weather):  # noqa: F811
    first = run(live_db, weather)
    calls = weather._fetch.call_count
    assert calls == 11  # 10 baseline years + 1 analysis year, no more
    second = run(live_db, weather)
    assert weather._fetch.call_count == calls
    first.pop("computed_at"), second.pop("computed_at")
    assert first == second
    assert live_db[database.WEATHER_RECORDS].count_documents({}) == 3652 + 365  # no duplicates


def test_heatwave_analysis_warms_the_anomaly_request(live_db, weather):  # noqa: F811
    HeatwaveService(live_db, weather_service=weather).analyze(LAT, LON, *WINDOW, 2010, 2019)
    calls = weather._fetch.call_count
    run(live_db, weather)
    assert weather._fetch.call_count == calls


def test_overlapping_window_does_not_reload_baseline_years(live_db, weather):  # noqa: F811
    result = anomaly_service(live_db, weather).analyze(LAT, LON, date(2015, 1, 1), date(2023, 12, 31), 2010, 2019)
    assert weather._fetch.call_count == 14  # 2010..2019 plus 2020..2023
    assert "analysis_overlaps_baseline" in result["data_quality"]["warnings"]


def test_simultaneous_identical_requests_fetch_each_year_once(live_db):  # noqa: F811
    weather = WeatherService(live_db)

    def slow_fetch(*args):
        time.sleep(0.05)
        return fake_fetch(*args)

    weather._fetch = MagicMock(side_effect=slow_fetch)
    results, errors = [], []

    def worker():
        try:
            results.append(anomaly_service(live_db, weather).analyze(LAT, LON, *WINDOW, 2010, 2019))
        except Exception as exc:  # pragma: no cover - surfaced by the assertion below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors and len(results) == 3
    assert weather._fetch.call_count == 11  # the keyed ingest locks make followers reuse the first fetch
    assert live_db[database.WEATHER_RECORDS].count_documents({}) == 3652 + 365
    for r in results:
        r.pop("computed_at")
    assert results[0] == results[1] == results[2]


def test_endpoints_share_data_and_heatwave_contract_is_unchanged(live_db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("DATABASE_NAME", live_db.name)
    get_settings.cache_clear()
    fetch = MagicMock(side_effect=fake_fetch)
    monkeypatch.setattr(WeatherService, "_fetch", lambda self, *a: fetch(*a))
    base = {"latitude": LAT, "longitude": LON, "start_date": "2023-01-01", "end_date": "2023-12-31",
            "baseline_start_year": 2010, "baseline_end_year": 2019}
    try:
        from app.main import app
        with TestClient(app) as client:
            heat = client.get("/api/heatwaves", params=base)
            assert heat.status_code == 200
            assert {"events", "annual", "summary", "trend", "baseline", "params_hash"} <= set(heat.json())
            assert heat.json()["summary"]["total_events"] == 1
            calls = fetch.call_count
            anomalies = client.get("/api/temperature-anomalies", params=base)
            assert anomalies.status_code == 200 and fetch.call_count == calls  # served from stored records
            body = anomalies.json()
            TemperatureAnomalyResponse.model_validate(body)
            assert body["baseline"]["start_year"] == 2010 and body["annual"][0]["year"] == 2023
            bad = client.get("/api/temperature-anomalies", params={**base, "latitude": 95})
            assert bad.status_code == 422
            short = client.get("/api/temperature-anomalies", params={**base, "baseline_start_year": 2018})
            assert short.status_code == 422 and "error" in short.json()["detail"]
    finally:
        get_settings.cache_clear()
