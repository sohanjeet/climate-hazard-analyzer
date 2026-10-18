"""Trend persistence/endpoint tests against a real MongoDB (throwaway database, Open-Meteo mocked)."""
import json
import uuid
from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import database
from app.config import get_settings
from app.schemas.analysis import HeatwaveAnalysisResponse
from app.services.heatwave_service import HeatwaveService
from app.services.trend_service import compute_trends
from app.services.weather_service import WeatherService
from tests.trend_helpers import SPELLS, series, spell_days, span, temperature

pytestmark = pytest.mark.integration

LAT, LON = 28.6139, 77.2090
PARAMS = dict(start_date="2020-01-01", end_date="2024-12-31", baseline_start_year=2010, baseline_end_year=2019)
HOT = spell_days()


def fake_fetch(latitude, longitude, start, end):
    days = span(start, end)
    return {"dates": [d.isoformat() for d in days], "temperatures": [temperature(d, HOT) for d in days]}


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


def run(service, window=None, end=date(2024, 12, 31)):
    return service.analyze(LAT, LON, date(2020, 1, 1), end, 2010, 2019, window)


def metric(trend, name):
    return next(m for m in trend["metrics"] if m["metric"] == name)


def test_trend_is_persisted_with_analysis_result(service, live_db):
    result = run(service)
    collection = live_db[database.ANALYSIS_RESULTS]
    assert collection.count_documents({}) == 1
    stored = collection.find_one({})
    assert stored["trend"] == result["trend"]  # BSON round trip preserves every field, None included
    assert stored["trend"]["method"]["method_version"] == "trend-v1"
    freq = metric(stored["trend"], "heatwave_frequency")
    assert freq["slope_per_year"] == pytest.approx(1.0) and freq["classification"] == "increasing"
    assert freq["zero_value_observations"] == 1 and 2020 in freq["years_used"]
    assert metric(stored["trend"], "mean_duration_days")["missing_value_years"] == [2020]
    json.dumps(stored["trend"], allow_nan=False)
    # the heatwave part of the stored document is unchanged by Phase 5
    assert stored["summary"]["total_events"] == 10 and [a["heatwave_count"] for a in stored["annual"]] == [0, 1, 2, 3, 4]


def test_stored_trend_matches_recomputation_from_stored_annual(service, live_db):
    run(service)
    stored = live_db[database.ANALYSIS_RESULTS].find_one({})
    again = compute_trends(stored["annual"], rolling_window_years=stored["trend"]["method"]["rolling_window_years"])
    assert again == stored["trend"]


def test_rerun_upserts_one_document_and_updates_rolling_window(service, live_db):
    run(service)
    collection = live_db[database.ANALYSIS_RESULTS]
    created_at = collection.find_one({})["created_at"]
    run(service, window=3)
    assert collection.count_documents({}) == 1
    stored = collection.find_one({})
    assert stored["created_at"] == created_at
    assert stored["trend"]["method"]["rolling_window_years"] == 3


def test_partial_year_is_stored_but_excluded_from_trend(service, live_db):
    result = service.analyze(LAT, LON, date(2020, 1, 1), date(2025, 6, 30), 2010, 2019)
    stored = live_db[database.ANALYSIS_RESULTS].find_one({})
    assert stored["annual"][-1]["year"] == 2025 and stored["annual"][-1]["is_complete"] is False
    freq = metric(stored["trend"], "heatwave_frequency")
    assert freq["excluded_incomplete_years"] == [2025] and 2025 not in freq["years_used"]
    assert freq["slope_per_year"] == pytest.approx(1.0)
    assert result["trend"] == stored["trend"]


def test_get_heatwaves_endpoint_returns_and_stores_trend(live_db, monkeypatch):
    monkeypatch.setenv("DATABASE_NAME", live_db.name)
    get_settings.cache_clear()
    monkeypatch.setattr(WeatherService, "_fetch", lambda self, *a: fake_fetch(*a))
    try:
        from app.main import app
        with TestClient(app) as client:
            params = {"latitude": LAT, "longitude": LON, **PARAMS}
            response = client.get("/api/heatwaves", params=params)
            assert response.status_code == 200
            body = response.json()
            parsed = HeatwaveAnalysisResponse.model_validate(body)
            assert parsed.trend is not None and parsed.trend.method.rolling_window_years == 5
            assert body["summary"]["total_events"] == 10  # existing fields untouched
            freq = metric(body["trend"], "heatwave_frequency")
            assert freq["n_observations"] == 5 and freq["classification"] == "increasing"
            assert freq["rolling_average"]["points"][-1]["rolling_mean"] == pytest.approx(2.0)

            custom = client.get("/api/heatwaves", params={**params, "rolling_window_years": 3})
            assert custom.status_code == 200 and custom.json()["trend"]["method"]["rolling_window_years"] == 3
            assert live_db[database.ANALYSIS_RESULTS].count_documents({}) == 1
            assert live_db[database.ANALYSIS_RESULTS].find_one({})["trend"]["method"]["rolling_window_years"] == 3

            assert client.get("/api/heatwaves", params={**params, "rolling_window_years": 1}).status_code == 422
    finally:
        get_settings.cache_clear()


def test_series_helper_matches_fake_fetch():
    data = series(date(2020, 1, 1), date(2020, 12, 31))
    assert sum(1 for v in data.values() if v > 40) == sum(SPELLS[2020]) == 0
    assert sum(1 for d in span(date(2024, 1, 1), date(2024, 12, 31)) if d in HOT) == sum(SPELLS[2024])
