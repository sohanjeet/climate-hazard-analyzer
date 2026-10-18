"""Database tests.

Unit tests run offline. Tests marked `integration` need a reachable MongoDB
(MONGODB_URI) and use a throwaway database that is dropped afterwards.
"""
import uuid

import pytest
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import database
from app.config import Settings, get_settings


def test_settings_hide_uri_in_repr():
    s = Settings(mongodb_uri="mongodb+srv://user:s3cret@cluster.example.net/")
    assert "s3cret" not in repr(s)
    assert "s3cret" not in str(s)
    assert "s3cret" in s.mongodb_uri.get_secret_value()


def test_connect_failure_does_not_leak_credentials(caplog):
    s = Settings(
        mongodb_uri="mongodb://user:s3cret@127.0.0.1:1/",
        mongodb_server_selection_timeout_ms=200,
    )
    with pytest.raises(RuntimeError) as exc:
        database.connect(s)
    assert "s3cret" not in str(exc.value)
    assert "s3cret" not in caplog.text
    assert not database.ping()


def test_get_client_requires_connect():
    database.close()
    with pytest.raises(RuntimeError):
        database.get_client()


@pytest.fixture
def live_db():
    settings = get_settings()
    name = f"test_{uuid.uuid4().hex[:12]}"
    client = MongoClient(settings.mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=3000)
    try:
        client.admin.command("ping")
    except PyMongoError:
        client.close()
        pytest.skip("MongoDB not reachable")
    yield client[name]
    client.drop_database(name)
    client.close()


@pytest.mark.integration
def test_connect_and_ping_live():
    try:
        database.connect()
    except RuntimeError:
        pytest.skip("MongoDB not reachable")
    try:
        assert database.ping()
    finally:
        database.close()


@pytest.mark.integration
def test_ensure_indexes_live(live_db):
    database.ensure_indexes(live_db)
    database.ensure_indexes(live_db)  # idempotent

    weather = live_db[database.WEATHER_RECORDS].index_information()
    assert weather["uniq_location_date"]["unique"] is True
    assert weather["uniq_location_date"]["key"] == [("location_key", 1), ("date", 1)]
    assert "date" in weather

    analysis = live_db[database.ANALYSIS_RESULTS].index_information()
    assert "location_type_range" in analysis and "created_at" in analysis

    cache = live_db[database.INGESTION_CACHE].index_information()
    assert cache["uniq_cache_key"]["unique"] is True
    assert cache["ttl_expires_at"]["expireAfterSeconds"] == 0
