"""Open-Meteo retry/timeout behaviour and best-effort persistence (offline, no real network)."""
import logging
from datetime import date
from unittest.mock import MagicMock

import httpx
import pytest
from pymongo.errors import AutoReconnect, DuplicateKeyError

from app.config import Settings
from app.services import weather_service
from app.services.heatwave_service import HeatwaveService
from app.services.weather_service import WeatherService, WeatherServiceError

REQUEST = httpx.Request("GET", "https://archive.example/v1")
GOOD_PAYLOAD = {"daily": {"time": ["2024-01-01"], "temperature_2m_max": [21.5]}}


def reply(status=200, payload=None, headers=None):
    return httpx.Response(status, json=payload if payload is not None else GOOD_PAYLOAD, headers=headers, request=REQUEST)


class ScriptedClient:
    """Plays back one step per call (a response or an exception); the last step repeats."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        step = self.steps.pop(0) if len(self.steps) > 1 else self.steps[0]
        if isinstance(step, BaseException):
            raise step
        return step


@pytest.fixture
def sleeps(monkeypatch):
    recorded = []
    monkeypatch.setattr(weather_service, "_sleep", recorded.append)
    return recorded


def fetch(client, **overrides):
    values = dict(open_meteo_max_retries=2, open_meteo_backoff_base_seconds=0.5,
                  open_meteo_backoff_max_seconds=8, open_meteo_timeout_seconds=7)
    settings = Settings(**{**values, **overrides})
    return WeatherService(MagicMock(), settings, http_client=client)._fetch(28.6, 77.2, date(2024, 1, 1), date(2024, 1, 1))


def test_transient_failures_are_retried_with_exponential_backoff(sleeps):
    client = ScriptedClient(reply(503), reply(502), reply())
    assert fetch(client)["temperatures"] == [21.5]
    assert len(client.calls) == 3
    assert 0.5 <= sleeps[0] <= 0.5 * 1.25 and 1.0 <= sleeps[1] <= 1.0 * 1.25


def test_retries_are_bounded_and_the_final_status_is_reported(sleeps):
    client = ScriptedClient(reply(503))
    with pytest.raises(WeatherServiceError) as exc:
        fetch(client)
    assert len(client.calls) == 3 and len(sleeps) == 2  # 1 attempt + 2 retries, never more
    assert exc.value.status_code == 502


def test_backoff_is_capped(sleeps):
    client = ScriptedClient(reply(500))
    with pytest.raises(WeatherServiceError):
        fetch(client, open_meteo_max_retries=5, open_meteo_backoff_max_seconds=2)
    assert len(client.calls) == 6 and max(sleeps) <= 2 * 1.25


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_permanent_client_errors_are_not_retried(sleeps, status):
    client = ScriptedClient(reply(status, payload={"error": True, "reason": "bad"}))
    with pytest.raises(WeatherServiceError) as exc:
        fetch(client)
    assert len(client.calls) == 1 and sleeps == [] and exc.value.status_code == 502


def test_invalid_json_is_not_retried(sleeps):
    client = ScriptedClient(httpx.Response(200, content=b"<html>not json</html>", request=REQUEST))
    with pytest.raises(WeatherServiceError):
        fetch(client)
    assert len(client.calls) == 1 and sleeps == []


def test_structurally_invalid_payload_is_not_retried(sleeps):
    client = ScriptedClient(reply(200, payload={"daily": {"time": [1, 2], "temperature_2m_max": [1]}}))
    with pytest.raises(WeatherServiceError, match="incomplete"):
        fetch(client)
    assert len(client.calls) == 1


def test_timeouts_are_retried_then_reported_as_504(sleeps):
    client = ScriptedClient(httpx.ReadTimeout("slow"))
    with pytest.raises(WeatherServiceError) as exc:
        fetch(client)
    assert len(client.calls) == 3 and exc.value.status_code == 504


def test_network_errors_are_retried_and_can_recover(sleeps):
    client = ScriptedClient(httpx.ConnectError("refused"), reply())
    assert fetch(client)["dates"] == ["2024-01-01"]
    assert len(client.calls) == 2


def test_zero_retries_means_a_single_attempt(sleeps):
    client = ScriptedClient(reply(503))
    with pytest.raises(WeatherServiceError):
        fetch(client, open_meteo_max_retries=0)
    assert len(client.calls) == 1 and sleeps == []


def test_every_request_has_explicit_connect_and_read_timeouts(sleeps):
    client = ScriptedClient(reply())
    fetch(client)
    timeout = client.calls[0]["timeout"]
    assert timeout.read == 7 and timeout.connect == 5 and timeout.write == 7 and timeout.pool == 7


def test_rate_limited_upstream_honours_short_retry_after(sleeps):
    client = ScriptedClient(reply(429, headers={"Retry-After": "3"}), reply())
    assert fetch(client)["dates"] == ["2024-01-01"]
    assert sleeps == [3.0]


def test_rate_limited_upstream_with_long_retry_after_fails_fast(sleeps):
    client = ScriptedClient(reply(429, headers={"Retry-After": "3600"}))
    with pytest.raises(WeatherServiceError) as exc:
        fetch(client)
    assert len(client.calls) == 1 and sleeps == [] and exc.value.status_code == 503


def test_persistent_rate_limiting_maps_to_503(sleeps):
    with pytest.raises(WeatherServiceError) as exc:
        fetch(ScriptedClient(reply(429)))
    assert exc.value.status_code == 503


def test_failure_logs_have_category_and_no_coordinates_or_urls(sleeps, caplog):
    with caplog.at_level(logging.INFO):
        with pytest.raises(WeatherServiceError):
            fetch(ScriptedClient(httpx.ConnectError("could not reach https://archive.example?latitude=28.600000")))
    assert caplog.text.count("upstream_failure category=network") == 3
    assert "28.6" not in caplog.text and "archive.example" not in caplog.text


# ----------------------------------------------------------------------------- persistence of results


def saved_result():
    return {
        "location_key": "1.000000,2.000000", "analysis_type": "heatwave", "start_date": date(2023, 1, 1),
        "end_date": date(2023, 12, 31), "params_hash": "h", "data_quality": {"missing_dates": []},
    }


def service_with(collection):
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: collection
    return HeatwaveService(db, Settings(), weather_service=MagicMock())


def test_save_retries_once_when_a_concurrent_insert_wins_the_unique_key():
    collection = MagicMock()
    collection.update_one.side_effect = [DuplicateKeyError("dup"), MagicMock()]
    service_with(collection)._save(saved_result())
    assert collection.update_one.call_count == 2
    assert collection.update_one.call_args.kwargs == {"upsert": True}


def test_save_failure_does_not_fail_the_analysis_or_leak_driver_text(caplog):
    collection = MagicMock()
    collection.update_one.side_effect = AutoReconnect("mongodb://user:s3cret@db.internal down")
    with caplog.at_level(logging.DEBUG):
        service_with(collection)._save(saved_result())  # must not raise
    assert "analysis_result_save_failed error=AutoReconnect" in caplog.text
    assert "s3cret" not in caplog.text and "db.internal" not in caplog.text
