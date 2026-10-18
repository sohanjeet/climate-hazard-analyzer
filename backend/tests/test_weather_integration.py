"""Weather service/endpoint tests against a real MongoDB (throwaway database, Open-Meteo mocked)."""
import uuid
from datetime import date, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import database
from app.config import get_settings
from app.services.weather_service import WeatherService

pytestmark = pytest.mark.integration

END = date.today() - timedelta(days=30)
START = END - timedelta(days=4)


def fake_fetch(latitude, longitude, start, end):
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return {"dates": [d.isoformat() for d in days], "temperatures": [20.0 + d.day for d in days]}


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
    svc = WeatherService(live_db)
    svc._fetch = MagicMock(side_effect=fake_fetch)
    return svc


def test_persist_cache_hit_and_idempotent_upsert(service, live_db):
    first = service.ingest(28.6139, 77.2090, START, END)
    assert first["complete"] and first["record_count"] == 5 and not first["cache_hit"]
    assert live_db[database.WEATHER_RECORDS].count_documents({}) == 5

    second = service.ingest(28.6139, 77.2090, START, END)
    assert second["cache_hit"] is True
    assert service._fetch.call_count == 1

    service._upsert(first["records"])
    assert live_db[database.WEATHER_RECORDS].count_documents({}) == 5


def test_partial_range_fetches_only_missing_dates(service, live_db):
    service.ingest(1, 2, START, END)
    result = service.ingest(1, 2, START - timedelta(days=2), END)
    assert result["record_count"] == 7 and result["complete"]
    assert service._fetch.call_args.args[2:] == (START - timedelta(days=2), START - timedelta(days=1))
    assert live_db[database.WEATHER_RECORDS].count_documents({}) == 7


def test_get_weather_endpoint(live_db, monkeypatch):
    monkeypatch.setenv("DATABASE_NAME", live_db.name)
    get_settings.cache_clear()
    monkeypatch.setattr(WeatherService, "_fetch", lambda self, *a: fake_fetch(*a))
    try:
        from app.main import app
        with TestClient(app) as client:
            params = {"latitude": 28.6139, "longitude": 77.2090, "start_date": START.isoformat(), "end_date": END.isoformat()}
            body = client.get("/api/weather", params=params).json()
            assert body["record_count"] == 5 and body["cache_hit"] is False
            assert client.get("/api/weather", params=params).json()["cache_hit"] is True
            assert client.get("/api/weather", params={**params, "latitude": 95}).status_code == 422
    finally:
        get_settings.cache_clear()
