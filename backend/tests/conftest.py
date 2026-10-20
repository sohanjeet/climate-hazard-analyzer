import os
from urllib.parse import urlsplit

import pytest

# Tests must never reach the database configured in backend/.env, which may be a production Atlas cluster: the
# integration fixtures create and drop throwaway databases on whatever MONGODB_URI resolves to. Pin it before any app
# module reads the settings (app.main builds the app at import); environment variables take precedence over .env.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def is_local_mongodb_uri(uri: str) -> bool:
    parts = urlsplit(uri)
    return parts.scheme == "mongodb" and (parts.hostname or "") in LOCAL_HOSTS


PROTECTED_DATABASE = "climate_hazard_db"


def names_protected_database(uri: str) -> bool:
    return urlsplit(uri).path.strip("/") == PROTECTED_DATABASE


TEST_MONGODB_URI = os.environ.get("TEST_MONGODB_URI", "mongodb://localhost:27017")
if not is_local_mongodb_uri(TEST_MONGODB_URI):
    # DANGEROUS override: the integration fixtures create and drop `test_*` databases on this server. Only ever point
    # it at a dedicated, disposable deployment (never the production Atlas cluster or one holding real data).
    if os.environ.get("ALLOW_REMOTE_TEST_DB") != "1":
        raise RuntimeError(
            "TEST_MONGODB_URI must point at a local MongoDB (mongodb://localhost...). "
            "ALLOW_REMOTE_TEST_DB=1 overrides this, but is DANGEROUS: the tests create and drop databases on that "
            "server, so use it only with a dedicated disposable test deployment."
        )
    if names_protected_database(TEST_MONGODB_URI):
        raise RuntimeError(f"TEST_MONGODB_URI must not name the application database {PROTECTED_DATABASE!r}.")
os.environ["MONGODB_URI"] = TEST_MONGODB_URI

from fastapi.testclient import TestClient  # noqa: E402  (imports below must see the pinned URI)

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402

get_settings.cache_clear()


@pytest.fixture
def make_client(monkeypatch):
    """Build a fresh app (own rate limiter) with environment overrides, without running the lifespan.

    No MongoDB connection is opened, so the client suits tests that stub the services.
    """
    clients = []

    def factory(**env: str) -> TestClient:
        for name, value in env.items():
            monkeypatch.setenv(name.upper(), str(value))
        get_settings.cache_clear()
        client = TestClient(create_app(), raise_server_exceptions=False)
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.close()
    monkeypatch.undo()
    get_settings.cache_clear()
