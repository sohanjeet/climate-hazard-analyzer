import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


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
