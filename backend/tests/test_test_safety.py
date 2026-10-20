"""The suite must never write to the database configured for the running app (possibly Atlas)."""

from app.config import get_settings
from tests.conftest import is_local_mongodb_uri, names_protected_database


def test_settings_resolve_to_a_local_mongodb_during_tests():
    get_settings.cache_clear()
    assert is_local_mongodb_uri(get_settings().mongodb_uri.get_secret_value())


def test_remote_and_srv_uris_are_not_treated_as_local():
    assert is_local_mongodb_uri("mongodb://localhost:27017")
    assert is_local_mongodb_uri("mongodb://127.0.0.1:27017/?directConnection=true")
    assert not is_local_mongodb_uri("mongodb+srv://user:pw@cluster0.example.mongodb.net/")
    assert not is_local_mongodb_uri("mongodb://db.example.com:27017")
    assert not is_local_mongodb_uri("mongodb://localhost.example.com:27017")


def test_application_database_is_recognised_as_protected():
    assert names_protected_database("mongodb+srv://u:p@c.example.net/climate_hazard_db?retryWrites=true")
    assert not names_protected_database("mongodb+srv://u:p@c.example.net/disposable_tests")
    assert not names_protected_database("mongodb://localhost:27017")
