import pytest

from app.middleware import RateLimiter

GOOD = {"latitude": 28.6139, "longitude": 77.2090, "start_date": "2023-01-01", "end_date": "2023-01-05"}
BAD = {**GOOD, "latitude": 999}  # rejected by validation, so no database or upstream access is needed


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_limiter_blocks_after_limit_and_recovers_when_window_slides():
    clock = Clock()
    limiter = RateLimiter(window_seconds=60, clock=clock)
    assert [limiter.check("a", 3) for _ in range(3)] == [None, None, None]
    assert limiter.check("a", 3) == 60
    clock.now += 30
    assert limiter.check("a", 3) == 30  # oldest hit leaves the window in 30 s
    clock.now += 31
    assert limiter.check("a", 3) is None


def test_limiter_tracks_clients_independently():
    limiter = RateLimiter(clock=Clock())
    assert limiter.check("a", 1) is None and limiter.check("a", 1) is not None
    assert limiter.check("b", 1) is None


def test_limiter_memory_is_bounded():
    clock = Clock()
    limiter = RateLimiter(window_seconds=60, max_clients=100, clock=clock)
    for i in range(500):
        limiter.check(f"client-{i}", 5)
    assert len(limiter._hits) <= 100
    clock.now += 61  # everything expired
    limiter.check("fresh", 5)
    for i in range(100):
        limiter.check(f"later-{i}", 5)
    assert len(limiter._hits) <= 100


def test_api_returns_429_with_retry_after_and_json_body(make_client):
    client = make_client(rate_limit_requests_per_minute=3, cors_allowed_origins="http://localhost:5173")
    assert [client.get("/api/weather", params=BAD).status_code for _ in range(3)] == [422, 422, 422]
    blocked = client.get("/api/weather", params=BAD, headers={"Origin": "http://localhost:5173"})
    assert blocked.status_code == 429
    assert blocked.json() == {"detail": {"error": "Rate limit exceeded; retry later"}}
    assert 1 <= int(blocked.headers["retry-after"]) <= 60
    assert blocked.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_heatwave_endpoint_has_its_own_stricter_bucket(make_client):
    client = make_client(rate_limit_requests_per_minute=50, rate_limit_heatwave_requests_per_minute=2)
    assert client.get("/api/heatwaves", params=BAD).status_code == 422
    assert client.get("/api/heatwaves", params=BAD).status_code == 422
    assert client.get("/api/heatwaves", params=BAD).status_code == 429
    assert client.get("/api/weather", params=BAD).status_code == 422  # other endpoints unaffected


def test_health_checks_and_docs_are_not_rate_limited(make_client):
    client = make_client(rate_limit_requests_per_minute=1, rate_limit_heatwave_requests_per_minute=1)
    assert all(client.get("/health").status_code == 200 for _ in range(10))
    assert all(client.get("/openapi.json").status_code == 200 for _ in range(3))


def test_limit_can_be_disabled(make_client):
    client = make_client(rate_limit_enabled="false", rate_limit_requests_per_minute=1)
    assert all(client.get("/api/weather", params=BAD).status_code == 422 for _ in range(5))


def test_forwarded_for_is_ignored_unless_proxy_is_trusted(make_client):
    client = make_client(rate_limit_requests_per_minute=1)
    assert client.get("/api/weather", params=BAD, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 422
    # A spoofed header must not mint a fresh allowance.
    assert client.get("/api/weather", params=BAD, headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 429


def test_trusted_proxy_header_separates_clients(make_client):
    client = make_client(rate_limit_requests_per_minute=1, trust_proxy_headers="true")
    assert client.get("/api/weather", params=BAD, headers={"X-Forwarded-For": "9.9.9.9, 1.1.1.1"}).status_code == 422
    assert client.get("/api/weather", params=BAD, headers={"X-Forwarded-For": "8.8.8.8, 1.1.1.1"}).status_code == 429  # same last hop
    assert client.get("/api/weather", params=BAD, headers={"X-Forwarded-For": "9.9.9.9, 2.2.2.2"}).status_code == 422


@pytest.mark.parametrize("bad", [0, -1])
def test_rate_limit_settings_must_be_positive(bad):
    from app.config import Settings
    with pytest.raises(ValueError):
        Settings(rate_limit_requests_per_minute=bad)
