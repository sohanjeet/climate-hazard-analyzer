"""Heatwave service/endpoint tests against a real MongoDB (throwaway database, Open-Meteo mocked)."""
import uuid
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import database
from app.config import get_settings
from app.schemas.analysis import HeatwaveAnalysisResponse
from app.services.heatwave_service import HeatwaveService
from app.services.weather_service import WeatherService

pytestmark = pytest.mark.integration

LAT, LON = 28.6139, 77.2090
HOT = (date(2023, 7, 10), date(2023, 7, 14))
PARAMS = dict(start_date="2023-01-01", end_date="2023-12-31", baseline_start_year=2010, baseline_end_year=2019)


def synthetic_temperature(day):
    """Deterministic synthetic series (not real climate data): 15-34.9 C, hot spell in July 2023."""
    if HOT[0] <= day <= HOT[1]:
        return 45.0
    return 15.0 + ((day.toordinal() * 37) % 200) / 10


def fake_fetch(latitude, longitude, start, end):
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return {"dates": [d.isoformat() for d in days], "temperatures": [synthetic_temperature(d) for d in days]}


@pytest.fixture
def live_db():
    client = MongoClient(get_settings().mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=3000)
    try:
        client.admin.command("ping")
    except PyMongoError:
        client.close()
        pytest.skip("MongoDB not reachable")
    name = f"test_{uuid.uuid4().hex[:12]}"
    db = client[name]
    database.ensure_indexes(db)
    yield db
    client.drop_database(name)
    client.close()


@pytest.fixture
def service(live_db):
    weather = WeatherService(live_db)
    weather._fetch = MagicMock(side_effect=fake_fetch)
    return HeatwaveService(live_db, weather_service=weather)


def run(service):
    return service.analyze(LAT, LON, date(2023, 1, 1), date(2023, 12, 31), 2010, 2019)


def test_analyze_persists_result_idempotently(service, live_db):
    result = run(service)
    assert result["summary"]["total_events"] == 1
    assert result["events"][0]["duration_days"] == 5
    collection = live_db[database.ANALYSIS_RESULTS]
    assert collection.count_documents({}) == 1
    stored = collection.find_one({})
    assert isinstance(stored["start_date"], datetime) and isinstance(stored["end_date"], datetime)
    assert isinstance(stored["events"][0]["start_date"], datetime)
    assert stored["analysis_type"] == "heatwave" and stored["params_hash"] == result["params_hash"]
    assert stored["baseline"]["threshold_c"] == result["baseline"]["threshold_c"]
    created_at = stored["created_at"]

    run(service)
    assert collection.count_documents({}) == 1
    assert collection.find_one({})["created_at"] == created_at


def test_second_analysis_reuses_stored_weather(service, live_db):
    run(service)
    calls = service.weather._fetch.call_count
    assert calls == 11  # 10 baseline years + 1 analysis year
    run(service)
    assert service.weather._fetch.call_count == calls


def test_get_heatwaves_endpoint(live_db, monkeypatch):
    monkeypatch.setenv("DATABASE_NAME", live_db.name)
    get_settings.cache_clear()
    monkeypatch.setattr(WeatherService, "_fetch", lambda self, *a: fake_fetch(*a))
    try:
        from app.main import app
        with TestClient(app) as client:
            params = {"latitude": LAT, "longitude": LON, **PARAMS}
            response = client.get("/api/heatwaves", params=params)
            assert response.status_code == 200
            parsed = HeatwaveAnalysisResponse.model_validate(response.json())
            assert parsed.summary.total_events == 1
            assert live_db[database.ANALYSIS_RESULTS].count_documents({}) == 1
            assert client.get("/api/heatwaves", params={**params, "latitude": 95}).status_code == 422
            bad = client.get("/api/heatwaves", params={**params, "baseline_start_year": 2018})
            assert bad.status_code == 422 and "error" in bad.json()["detail"]
    finally:
        get_settings.cache_clear()
