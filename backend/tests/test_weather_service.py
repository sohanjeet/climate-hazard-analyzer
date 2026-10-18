from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services.weather_service import WeatherService, WeatherServiceError, cache_key, location_key
from app.models.weather import WeatherResponse


def settings():
    from app.config import Settings
    return Settings(weather_max_range_days=10, open_meteo_timeout_seconds=1)


def db():
    value = MagicMock()
    value.__getitem__.side_effect = lambda name: getattr(value, name)
    value.weather_records.find.return_value = []
    value.ingestion_cache.find_one.return_value = None
    return value


def response(payload, status=200):
    return httpx.Response(status, json=payload, request=httpx.Request("GET", "https://example.test"))


class FakeClient:
    def __init__(self, result):
        self.result = result

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, *args, **kwargs):
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


def test_fetch_uses_mocked_httpx_response():
    payload = {"daily": {"time": ["2024-01-01"], "temperature_2m_max": [21.5]}}
    service = WeatherService(db(), settings(), http_client=FakeClient(response(payload)))
    result = service._fetch(1, 2, date(2024, 1, 1), date(2024, 1, 1))
    assert result == {"dates": ["2024-01-01"], "temperatures": [21.5]}


def test_validation_rejects_invalid_coordinates_and_range():
    service = WeatherService(db(), settings())
    with pytest.raises(WeatherServiceError, match="latitude"):
        service.validate_request(91, 2, date(2024, 1, 1), date(2024, 1, 1))
    with pytest.raises(WeatherServiceError, match="on or before"):
        service.validate_request(1, 2, date(2024, 1, 2), date(2024, 1, 1))


def test_weather_endpoint_response_schema():
    from app.routers.weather import get_weather

    now = datetime.now(timezone.utc)
    payload = {
        "location_key": "1.000000,2.000000", "start_date": date(2024, 1, 1), "end_date": date(2024, 1, 1),
        "records": [{"location_key": "1.000000,2.000000", "date": date(2024, 1, 1), "latitude": 1,
                     "longitude": 2, "temperature_max_c": 20, "source": "open-meteo-archive",
                     "quality": {}, "fetched_at": now}], "record_count": 1, "complete": True,
        "missing_dates": [], "cache_hit": True, "source": "open-meteo-archive", "warnings": [],
    }
    with patch("app.routers.weather.WeatherService") as service_cls:
        service_cls.return_value.ingest.return_value = payload
        result = get_weather(1, 2, date(2024, 1, 1), date(2024, 1, 1))
    assert WeatherResponse.model_validate(result).record_count == 1


def test_ingestion_normalizes_and_bulk_upserts():
    database = db()
    service = WeatherService(database, settings())
    payload = {"daily": {"time": ["2024-01-01", "2024-01-02"], "temperature_2m_max": [21.5, 22]}}
    service._fetch = MagicMock(return_value={"dates": payload["daily"]["time"], "temperatures": payload["daily"]["temperature_2m_max"]})
    result = service.ingest(12.3456789, 77.1234567, date(2024, 1, 1), date(2024, 1, 2))
    assert result["complete"] is True
    assert result["record_count"] == 2
    assert result["records"][0]["location_key"] == location_key(12.3456789, 77.1234567)
    assert database.weather_records.bulk_write.call_count == 1
    assert len(database.weather_records.bulk_write.call_args.args[0]) == 2


def test_cache_hit_avoids_external_call():
    database = db()
    now = datetime.now(timezone.utc)
    database.ingestion_cache.find_one.return_value = {"complete": True, "expires_at": now}
    database.weather_records.find.return_value = [
        {"location_key": location_key(1, 2), "date": date(2024, 1, 1), "latitude": 1, "longitude": 2,
         "temperature_max_c": 20, "source": "open-meteo-archive", "quality": {}, "fetched_at": now}
    ]
    service = WeatherService(database, settings())
    service._fetch = MagicMock()
    result = service.ingest(1, 2, date(2024, 1, 1), date(2024, 1, 1))
    assert result["cache_hit"] is True
    service._fetch.assert_not_called()


def test_missing_temperature_is_not_claimed_complete():
    database = db()
    service = WeatherService(database, settings())
    payload = {"daily": {"time": ["2024-01-01", "2024-01-02"], "temperature_2m_max": [None, 22]}}
    service._fetch = MagicMock(return_value={"dates": payload["daily"]["time"], "temperatures": payload["daily"]["temperature_2m_max"]})
    result = service.ingest(1, 2, date(2024, 1, 1), date(2024, 1, 2))
    assert result["complete"] is False
    assert result["missing_dates"] == [date(2024, 1, 1)]
    assert result["record_count"] == 1


def test_timeout_is_mapped_to_service_error():
    service = WeatherService(db(), settings())
    service._fetch = MagicMock(side_effect=WeatherServiceError("Open-Meteo request timed out", 504))
    with pytest.raises(WeatherServiceError, match="timed out") as exc:
        service.ingest(1, 2, date(2024, 1, 1), date(2024, 1, 1))
    assert exc.value.status_code == 504


def test_keys_are_deterministic_and_precision_is_explicit():
    assert location_key(1.0000001, 2.0000001) == "1.000000,2.000000"
    assert cache_key(1, 2, date(2024, 1, 1), date(2024, 1, 2)) == cache_key(1, 2, date(2024, 1, 1), date(2024, 1, 2))
