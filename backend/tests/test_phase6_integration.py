"""Phase 6 regression tests against a real MongoDB (throwaway databases; Open-Meteo is mocked)."""
import threading
import time
import uuid
from datetime import date, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import database
from app.config import Settings, get_settings
from app.main import create_app
from app.schemas.analysis import HeatwaveAnalysisResponse
from app.models.weather import WeatherResponse
from app.services.heatwave_service import HeatwaveService
from app.services.weather_service import WeatherService, _to_datetime

pytestmark = pytest.mark.integration

LAT, LON = 28.6139, 77.2090
ANALYSIS = (date(2023, 1, 1), date(2023, 12, 31))
BASELINE = (2010, 2019)
HOLE = date(2023, 3, 1)       # Open-Meteo reports null for this day
HOT = (date(2023, 7, 10), date(2023, 7, 14))


def temperature(day):
    if HOT[0] <= day <= HOT[1]:
        return 45.0
    if day == HOLE:
        return None
    return 15.0 + ((day.toordinal() * 37) % 200) / 10


def fake_fetch(latitude, longitude, start, end):
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return {"dates": [d.isoformat() for d in days], "temperatures": [temperature(d) for d in days]}


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(get_settings().mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=3000)
    try:
        client.admin.command("ping")
    except PyMongoError:
        client.close()
        pytest.skip("MongoDB not reachable")
    yield client
    client.close()


@pytest.fixture
def new_db(mongo):
    created = []

    def factory(indexes=True):
        db = mongo[f"test_{uuid.uuid4().hex[:12]}"]
        if indexes:
            database.ensure_indexes(db)
        created.append(db.name)
        return db

    yield factory
    for name in created:
        mongo.drop_database(name)


def build(db, concurrency=4, fetch=fake_fetch, delay=0.0):
    weather = WeatherService(db, Settings(weather_fetch_concurrency=concurrency))

    def slow_fetch(*args):
        time.sleep(delay)
        return fetch(*args)

    weather._fetch = MagicMock(side_effect=slow_fetch)
    return HeatwaveService(db, Settings(weather_fetch_concurrency=concurrency), weather_service=weather)


def analyze(service):
    return service.analyze(LAT, LON, *ANALYSIS, *BASELINE)


def comparable(result):
    return {k: v for k, v in result.items() if k != "computed_at"}


# ----------------------------------------------------------------------------- concurrency vs correctness


def test_concurrent_loading_gives_identical_results_to_sequential_loading(new_db):
    sequential, concurrent = build(new_db(), 1), build(new_db(), 4)
    a, b = analyze(sequential), analyze(concurrent)
    assert comparable(a) == comparable(b)
    assert a["data_quality"]["missing_dates"] == [HOLE]  # partial coverage is still reported
    assert a["data_quality"]["analysis_coverage"] == pytest.approx(364 / 365)
    assert "analysis_missing_days:1" in a["data_quality"]["warnings"]
    year_2023 = next(r for r in a["annual"] if r["year"] == 2023)
    assert year_2023["days_observed"] == 364 and year_2023["is_complete"] is True  # 99.7% >= 95%
    assert concurrent.weather._fetch.call_count == sequential.weather._fetch.call_count == 11


def test_stored_weather_is_reused_and_only_missing_days_are_refetched(new_db):
    db = new_db()
    service = build(db, 4)
    analyze(service)
    assert service.weather._fetch.call_count == 11
    stored = db[database.WEATHER_RECORDS].count_documents({})
    assert stored == sum(366 if y % 4 == 0 else 365 for y in [*range(2010, 2020), 2023]) - 1  # the null day is not stored

    service.weather._fetch.reset_mock()
    analyze(service)
    # Only the one chunk that contains the unrecovered day goes back upstream, and only for that day.
    assert [c.args[2:] for c in service.weather._fetch.call_args_list] == [(HOLE, HOLE)]
    assert db[database.WEATHER_RECORDS].count_documents({}) == stored


def test_fully_warm_analysis_makes_no_upstream_requests(new_db):
    service = build(new_db(), 4, fetch=lambda la, lo, s, e: {
        "dates": [(s + timedelta(days=i)).isoformat() for i in range((e - s).days + 1)],
        "temperatures": [20.0 + (s + timedelta(days=i)).day for i in range((e - s).days + 1)]})
    analyze(service)
    service.weather._fetch.reset_mock()
    analyze(service)
    assert service.weather._fetch.call_count == 0


def test_identical_concurrent_requests_share_one_upstream_fetch(new_db):
    db = new_db()
    service = build(db, 4, delay=0.15)
    weather = service.weather
    results = []
    threads = [threading.Thread(target=lambda: results.append(
        weather.ingest(LAT, LON, date(2022, 6, 1), date(2022, 6, 10)))) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert weather._fetch.call_count == 1
    assert len(results) == 6 and all(r["record_count"] == 10 for r in results)
    assert sorted(r["cache_hit"] for r in results) == [False] + [True] * 5
    assert db[database.WEATHER_RECORDS].count_documents({}) == 10


def test_weather_upserts_are_idempotent_under_concurrency(new_db):
    db = new_db()
    service = build(db, 4)
    records = service.weather.ingest(LAT, LON, date(2022, 6, 1), date(2022, 6, 20))["records"]
    threads = [threading.Thread(target=service.weather._upsert, args=(records,)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert db[database.WEATHER_RECORDS].count_documents({}) == 20


# ----------------------------------------------------------------------------- persistence


def test_concurrent_first_saves_of_the_same_analysis_create_one_document(new_db):
    # A smoke test: the race itself is rarely hit. Deterministic coverage is the unique-index test
    # below plus the DuplicateKeyError retry test in test_reliability.py.
    db = new_db()
    service = build(db, 4)
    result = analyze(service)
    db[database.ANALYSIS_RESULTS].delete_many({})
    threads = [threading.Thread(target=service._save, args=(result,)) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert db[database.ANALYSIS_RESULTS].count_documents({}) == 1


def test_analysis_results_have_a_unique_key_index(new_db):
    db = new_db()
    database.ensure_indexes(db)  # idempotent
    info = db[database.ANALYSIS_RESULTS].index_information()["uniq_analysis_key"]
    assert info["unique"] is True
    assert [k for k, _ in info["key"]] == ["location_key", "analysis_type", "start_date", "end_date", "params_hash"]


def test_startup_survives_preexisting_duplicates_that_block_the_unique_index(new_db):
    db = new_db(indexes=False)
    doc = {"location_key": "k", "analysis_type": "heatwave", "start_date": 1, "end_date": 2, "params_hash": "h"}
    db[database.ANALYSIS_RESULTS].insert_many([dict(doc), dict(doc)])
    database.ensure_indexes(db)  # must log and continue, not raise
    assert "uniq_analysis_key" not in db[database.ANALYSIS_RESULTS].index_information()


def test_rerun_with_another_rolling_window_overwrites_the_same_document(new_db):
    """Documents the known behaviour: the window is not part of the key, so the latest run wins."""
    db = new_db()
    service = build(db, 4)
    first = service.analyze(LAT, LON, *ANALYSIS, *BASELINE, rolling_window_years=5)
    created_at = db[database.ANALYSIS_RESULTS].find_one({})["created_at"]
    second = service.analyze(LAT, LON, *ANALYSIS, *BASELINE, rolling_window_years=3)
    docs = list(db[database.ANALYSIS_RESULTS].find({}))
    assert len(docs) == 1 and docs[0]["created_at"] == created_at
    assert first["trend"]["method"]["rolling_window_years"] == 5 and second["trend"]["method"]["rolling_window_years"] == 3
    assert docs[0]["trend"]["method"]["rolling_window_years"] == 3
    # The response always comes from the fresh computation, never from the stored copy.
    assert first["summary"] == second["summary"]


def test_concurrent_runs_with_different_windows_leave_one_consistent_document(new_db):
    db = new_db()
    service = build(db, 4)
    analyze(service)  # warm the weather cache so the runs below race on the save
    threads = [threading.Thread(target=service.analyze, args=(LAT, LON, *ANALYSIS, *BASELINE, w))
               for w in (2, 3, 4, 5, 6, 7)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    docs = list(db[database.ANALYSIS_RESULTS].find({}))
    assert len(docs) == 1
    # Whole-document $set: whichever run saved last wins, and its trend is internally consistent.
    window = docs[0]["trend"]["method"]["rolling_window_years"]
    assert window in range(2, 8)
    assert all(m["rolling_average"]["window_years"] == window for m in docs[0]["trend"]["metrics"])


# ----------------------------------------------------------------------------- indexes / query plans


def stages(plan):
    found = []
    if isinstance(plan, dict):
        if "stage" in plan:
            found.append(plan["stage"])
        for value in plan.values():
            found += stages(value)
    elif isinstance(plan, list):
        for item in plan:
            found += stages(item)
    return found


def test_hot_queries_use_indexes_not_collection_scans(new_db):
    db = new_db()
    analyze(build(db, 4))
    lo, hi = (_to_datetime(date(2015, 1, 1)), _to_datetime(date(2015, 12, 31)))
    weather_plan = db[database.WEATHER_RECORDS].find(
        {"location_key": "28.613900,77.209000", "date": {"$gte": lo, "$lte": hi}}).explain()
    assert "IXSCAN" in stages(weather_plan["queryPlanner"]["winningPlan"])
    assert "COLLSCAN" not in stages(weather_plan["queryPlanner"]["winningPlan"])
    cache_plan = db[database.INGESTION_CACHE].find({"cache_key": "x"}).explain()
    assert "COLLSCAN" not in stages(cache_plan["queryPlanner"]["winningPlan"])
    save_plan = db[database.ANALYSIS_RESULTS].find(
        {"location_key": "a", "analysis_type": "heatwave", "start_date": lo, "end_date": hi, "params_hash": "h"}).explain()
    assert "COLLSCAN" not in stages(save_plan["queryPlanner"]["winningPlan"])


# ----------------------------------------------------------------------------- API level


@pytest.fixture
def api(new_db, monkeypatch):
    db = new_db()
    monkeypatch.setenv("DATABASE_NAME", db.name)
    get_settings.cache_clear()
    monkeypatch.setattr(WeatherService, "_fetch", lambda self, *a: fake_fetch(*a))
    database.close()
    with TestClient(create_app()) as client:
        yield client, db
    get_settings.cache_clear()


PARAMS = {"latitude": LAT, "longitude": LON, "start_date": "2023-01-01", "end_date": "2023-12-31",
          "baseline_start_year": 2010, "baseline_end_year": 2019}


def test_heatwave_response_schema_is_unchanged(api):
    client, db = api
    response = client.get("/api/heatwaves", params=PARAMS)
    assert response.status_code == 200
    body = response.json()
    HeatwaveAnalysisResponse.model_validate(body)
    assert set(body) == {"location_key", "analysis_type", "latitude", "longitude", "start_date", "end_date", "method",
                         "params_hash", "baseline", "events", "annual", "summary", "trend", "data_quality", "source",
                         "computed_at"}
    assert body["data_quality"]["missing_dates"] == ["2023-03-01"]
    assert body["trend"]["method"]["rolling_window_years"] == 5
    assert response.headers["x-request-id"] and db[database.ANALYSIS_RESULTS].count_documents({}) == 1


def test_weather_response_schema_is_unchanged(api):
    client, _ = api
    end = date.today() - timedelta(days=30)
    response = client.get("/api/weather", params={"latitude": LAT, "longitude": LON,
                                                  "start_date": (end - timedelta(days=4)).isoformat(), "end_date": end.isoformat()})
    assert response.status_code == 200
    body = response.json()
    WeatherResponse.model_validate(body)
    assert set(body) == {"location_key", "start_date", "end_date", "records", "record_count", "complete",
                         "missing_dates", "cache_hit", "source", "warnings"}
    assert set(body["records"][0]) == {"location_key", "date", "latitude", "longitude", "temperature_max_c",
                                       "source", "quality", "fetched_at"}


def test_repeat_api_request_reuses_stored_weather(api, monkeypatch):
    client, _ = api
    calls = []
    monkeypatch.setattr(WeatherService, "_fetch", lambda self, *a: calls.append(a) or fake_fetch(*a))
    assert client.get("/api/heatwaves", params=PARAMS).status_code == 200
    cold = len(calls)
    assert client.get("/api/heatwaves", params=PARAMS).status_code == 200
    assert cold == 11 and len(calls) == cold + 1  # only the null day is retried


def test_health_endpoints_reflect_database_state(api):
    client, _ = api
    assert client.get("/health/db").json() == {"status": "healthy"}
    database.close()
    response = client.get("/health/db")
    assert response.status_code == 503 and response.json() == {"status": "unavailable"}


def test_database_outage_after_startup_returns_503_and_recovers(api):
    client, _ = api
    real = database._client
    database._client = None  # simulates losing the connection handle
    try:
        down = client.get("/api/heatwaves", params=PARAMS)
        assert down.status_code == 503 and down.json() == {"detail": {"error": "Database temporarily unavailable"}}
    finally:
        database._client = real
    assert client.get("/api/heatwaves", params=PARAMS).status_code == 200


def test_startup_fails_fast_without_leaking_credentials(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:s3cret-pw@127.0.0.1:1/")
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "300")
    get_settings.cache_clear()
    database.close()
    try:
        with pytest.raises(RuntimeError) as exc:
            with TestClient(create_app()):
                pass
        assert "s3cret" not in str(exc.value) and "s3cret" not in repr(exc.value.__cause__)
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_shutdown_closes_the_database_and_http_client(api):
    from app.services import weather_service
    client, _ = api
    weather_service._shared_client(get_settings())
    client.__exit__(None, None, None)
    assert database._client is None and weather_service._http_client is None
