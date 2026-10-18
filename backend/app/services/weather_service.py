"""Open-Meteo historical daily weather ingestion and persistence."""

from __future__ import annotations

import hashlib
import logging
import math
import random
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterator

import httpx
from pymongo import UpdateOne

from app import database
from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Transient upstream statuses worth retrying. Other 4xx mean our request is wrong; retrying cannot help.
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

_sleep = time.sleep  # indirection so tests can run retries without waiting

_http_lock = threading.Lock()
_http_client: httpx.Client | None = None
_slots: dict[int, threading.BoundedSemaphore] = {}


def _shared_client(settings: Settings) -> httpx.Client:
    """One pooled client for the process: reuses TLS connections across the many yearly requests."""
    global _http_client
    with _http_lock:
        if _http_client is None:
            limit = settings.weather_fetch_concurrency
            _http_client = httpx.Client(limits=httpx.Limits(max_connections=limit, max_keepalive_connections=limit))
        return _http_client


def close_http_client() -> None:
    global _http_client
    with _http_lock:
        if _http_client is not None:
            _http_client.close()
            _http_client = None


@contextmanager
def _upstream_slot(limit: int) -> Iterator[None]:
    """Process-wide cap on simultaneous Open-Meteo requests, however many API requests are in flight."""
    with _http_lock:
        semaphore = _slots.setdefault(limit, threading.BoundedSemaphore(limit))
    with semaphore:
        yield


class _KeyedLocks:
    """Serialises identical in-flight ingests so a second caller reuses the first caller's fetch."""

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: dict[str, list[Any]] = {}

    @contextmanager
    def hold(self, key: str) -> Iterator[None]:
        with self._guard:
            entry = self._locks.setdefault(key, [threading.Lock(), 0])
            entry[1] += 1
        try:
            with entry[0]:
                yield
        finally:
            with self._guard:
                entry[1] -= 1
                if entry[1] == 0:
                    self._locks.pop(key, None)


_ingest_locks = _KeyedLocks()


def _retry_after_seconds(response: httpx.Response) -> float | None:
    try:
        return max(0.0, float(response.headers.get("Retry-After", "")))
    except ValueError:
        return None


class WeatherServiceError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _to_datetime(value: date) -> datetime:
    """BSON cannot encode datetime.date; store days as midnight UTC datetimes."""
    return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)


def _coordinate(value: float) -> str:
    """Use six decimal places (~0.11m at the equator) for stable keys."""
    return f"{value:.6f}"


def location_key(latitude: float, longitude: float) -> str:
    return f"{_coordinate(latitude)},{_coordinate(longitude)}"


def cache_key(latitude: float, longitude: float, start_date: date, end_date: date) -> str:
    raw = f"open-meteo|daily-temperature_2m_max|{_coordinate(latitude)}|{_coordinate(longitude)}|{start_date.isoformat()}|{end_date.isoformat()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class WeatherService:
    source = "open-meteo-archive"

    def __init__(self, db: Any | None = None, settings: Settings | None = None,
                 http_client: httpx.Client | None = None):
        self.settings = settings or get_settings()
        self.db = db
        self._http = http_client

    def _db(self):
        return self.db if self.db is not None else database.get_db(self.settings)

    def validate_request(self, latitude: float, longitude: float, start: date, end: date) -> None:
        if not -90 <= latitude <= 90:
            raise WeatherServiceError("latitude must be between -90 and 90", 422)
        if not -180 <= longitude <= 180:
            raise WeatherServiceError("longitude must be between -180 and 180", 422)
        if start > end:
            raise WeatherServiceError("start_date must be on or before end_date", 422)
        days = (end - start).days + 1
        if days > self.settings.weather_max_range_days:
            raise WeatherServiceError(
                f"date range cannot exceed {self.settings.weather_max_range_days} days", 422
            )
        archive_start = date.fromisoformat(self.settings.weather_archive_start_date)
        archive_end = date.today() - timedelta(days=self.settings.weather_archive_lag_days)
        if start < archive_start or end > archive_end:
            raise WeatherServiceError(
                f"dates must be between {archive_start.isoformat()} and {archive_end.isoformat()} for the historical archive",
                422,
            )

    def _stored_records(self, loc: str, start: date, end: date) -> dict[date, dict[str, Any]]:
        docs = self._db()[database.WEATHER_RECORDS].find(
            {"location_key": loc, "date": {"$gte": _to_datetime(start), "$lte": _to_datetime(end)}},
            {"_id": 0},
        )
        result: dict[date, dict[str, Any]] = {}
        for doc in docs:
            if isinstance(doc["date"], datetime):
                doc["date"] = doc["date"].date()
            result[doc["date"]] = doc
        return result

    def stored_records(self, latitude: float, longitude: float, start: date, end: date) -> dict[date, dict[str, Any]]:
        """Return persisted observations for one location/date range in one indexed query.

        Analysis services use this as a warm-path fast path.  It deliberately does not
        consult ``ingestion_cache``: weather records themselves are the authoritative,
        durable cache and their unique ``(location_key, date)`` index guarantees that a
        complete range can be served without a second metadata round trip.
        """
        return self._stored_records(location_key(latitude, longitude), start, end)

    def _fetch(self, latitude: float, longitude: float, start: date, end: date) -> dict[str, Any]:
        params = {
            "latitude": _coordinate(latitude),
            "longitude": _coordinate(longitude),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "daily": "temperature_2m_max",
            "temperature_unit": "celsius",
            "timezone": "UTC",
        }
        s = self.settings
        client = self._http or _shared_client(s)
        timeout = httpx.Timeout(s.open_meteo_timeout_seconds,
                                connect=min(s.open_meteo_connect_timeout_seconds, s.open_meteo_timeout_seconds))
        attempts = s.open_meteo_max_retries + 1
        started = time.perf_counter()
        for attempt in range(1, attempts + 1):
            retry_after: float | None = None
            status: int | None = None
            try:
                with _upstream_slot(s.weather_fetch_concurrency):
                    response = client.get(s.open_meteo_base_url, params=params, timeout=timeout)
                response.raise_for_status()
                payload = response.json()
                break
            except httpx.TimeoutException as exc:
                category, retryable, cause = "timeout", True, exc
                error = WeatherServiceError("Open-Meteo request timed out", 504)
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                retryable, cause = status in _RETRYABLE_STATUS, exc
                retry_after = _retry_after_seconds(exc.response)
                if status == 429:
                    category = "rate_limited"
                    error = WeatherServiceError("Open-Meteo is rate limiting requests; try again shortly", 503)
                else:
                    category = "server_error" if status >= 500 else "client_error"
                    error = WeatherServiceError("Open-Meteo request failed", 502)
            except httpx.TransportError as exc:  # connection refused/reset, DNS, read errors
                category, retryable, cause = "network", True, exc
                error = WeatherServiceError("Open-Meteo request failed", 502)
            except (httpx.HTTPError, ValueError) as exc:  # malformed JSON, redirect loops, decoding errors
                category, retryable, cause = "invalid_response", False, exc
                error = WeatherServiceError("Open-Meteo request failed", 502)

            # Never log URLs or parameters: they contain the requested coordinates.
            logger.warning("upstream_failure category=%s status=%s attempt=%d/%d retryable=%s",
                           category, status, attempt, attempts, retryable)
            if not retryable or attempt == attempts:
                raise error from cause
            delay = min(s.open_meteo_backoff_max_seconds, s.open_meteo_backoff_base_seconds * 2 ** (attempt - 1))
            delay *= 1 + random.random() * 0.25
            if retry_after is not None:
                if retry_after > s.open_meteo_backoff_max_seconds:
                    raise error from cause  # upstream asks for a longer pause than we will hold a request
                delay = max(delay, retry_after)
            _sleep(delay)

        logger.info("upstream_fetch ok attempts=%d days=%d duration_ms=%d",
                    attempt, (end - start).days + 1, (time.perf_counter() - started) * 1000)
        if not isinstance(payload, dict) or not isinstance(payload.get("daily"), dict):
            raise WeatherServiceError("Open-Meteo returned an invalid response structure", 502)
        daily = payload["daily"]
        dates = daily.get("time")
        temperatures = daily.get("temperature_2m_max")
        if not isinstance(dates, list) or not isinstance(temperatures, list) or len(dates) != len(temperatures):
            raise WeatherServiceError("Open-Meteo returned incomplete daily arrays", 502)
        return {"dates": dates, "temperatures": temperatures}

    def _normalize(self, latitude: float, longitude: float, data: dict[str, Any]) -> tuple[list[dict[str, Any]], set[date], list[str]]:
        loc = location_key(latitude, longitude)
        now = datetime.now(timezone.utc)
        records: list[dict[str, Any]] = []
        seen: set[date] = set()
        missing: set[date] = set()
        warnings: list[str] = []
        for raw_date, raw_temp in zip(data["dates"], data["temperatures"]):
            try:
                parsed_date = date.fromisoformat(raw_date)
            except (TypeError, ValueError):
                warnings.append("invalid_date")
                continue
            if parsed_date in seen:
                warnings.append(f"duplicate_date:{parsed_date.isoformat()}")
                continue
            seen.add(parsed_date)
            if raw_temp is None:
                missing.add(parsed_date)
                continue
            try:
                temp = float(raw_temp)
            except (TypeError, ValueError):
                warnings.append(f"invalid_temperature:{parsed_date.isoformat()}")
                missing.add(parsed_date)
                continue
            if not math.isfinite(temp) or not -100 <= temp <= 70:
                warnings.append(f"invalid_temperature:{parsed_date.isoformat()}")
                missing.add(parsed_date)
                continue
            records.append({
                "location_key": loc,
                "date": parsed_date,
                "latitude": latitude,
                "longitude": longitude,
                "temperature_max_c": temp,
                "source": self.source,
                "quality": {"temperature_valid": True, "source_field": "temperature_2m_max"},
                "fetched_at": now,
            })
        return records, missing, warnings

    def _upsert(self, records: list[dict[str, Any]]) -> None:
        if not records:
            return
        collection = self._db()[database.WEATHER_RECORDS]
        operations = []
        for doc in records:
            day = _to_datetime(doc["date"])
            operations.append(UpdateOne(
                {"location_key": doc["location_key"], "date": day},
                {"$set": {**doc, "date": day}},
                upsert=True,
            ))
        collection.bulk_write(operations, ordered=False)

    def _write_cache(self, key: str, start: date, end: date, covered: set[date], warnings: list[str]) -> None:
        now = datetime.now(timezone.utc)
        self._db()[database.INGESTION_CACHE].update_one(
            {"cache_key": key},
            {"$set": {
                "cache_key": key, "start_date": _to_datetime(start), "end_date": _to_datetime(end),
                "covered_dates": sorted(d.isoformat() for d in covered),
                # Warnings such as a duplicate row do not make coverage incomplete;
                # completeness is determined strictly by the requested dates present.
                "complete": len(covered) == (end - start).days + 1,
                "expires_at": now + timedelta(seconds=self.settings.weather_cache_ttl_seconds),
                "updated_at": now,
            }},
            upsert=True,
        )

    def ingest(self, latitude: float, longitude: float, start: date, end: date) -> dict[str, Any]:
        self.validate_request(latitude, longitude, start, end)
        key = cache_key(latitude, longitude, start, end)
        with _ingest_locks.hold(key):
            return self._ingest_locked(latitude, longitude, start, end, key)

    def _ingest_locked(self, latitude: float, longitude: float, start: date, end: date, key: str) -> dict[str, Any]:
        loc = location_key(latitude, longitude)
        requested = set(_date_range(start, end))
        existing = self._stored_records(loc, start, end)
        # A complete persisted range is the durable cache.  Checking the separate
        # TTL metadata document used to add one MongoDB round trip to every warm
        # yearly chunk, even though it cannot make these records more complete.
        if requested.issubset(existing):
            records = [existing[d] for d in sorted(requested)]
            return self._response(records, start, end, True, [])
        missing_dates = requested - set(existing)
        warnings: list[str] = []
        if missing_dates:
            fetched = self._fetch(latitude, longitude, min(missing_dates), max(missing_dates))
            new_records, invalid_dates, warnings = self._normalize(latitude, longitude, fetched)
            new_records = [r for r in new_records if r["date"] in missing_dates]
            self._upsert(new_records)
            existing.update({r["date"]: r for r in new_records})
            # Missing/null/invalid dates deliberately remain uncovered and will be retried later.
            missing_dates |= invalid_dates
        covered = requested & set(existing)
        self._write_cache(key, start, end, covered, warnings if missing_dates else [])
        return self._response([existing[d] for d in sorted(covered)], start, end, False, warnings, requested - covered)

    def _response(self, records: list[dict[str, Any]], start: date, end: date, cache_hit: bool, warnings: list[str], missing: set[date] | None = None) -> dict[str, Any]:
        missing = missing or set()
        return {
            "location_key": records[0]["location_key"] if records else None,
            "start_date": start,
            "end_date": end,
            "records": records,
            "record_count": len(records),
            "complete": not missing and len(records) == (end - start).days + 1,
            "missing_dates": sorted(missing),
            "cache_hit": cache_hit,
            "source": self.source,
            "warnings": sorted(set(warnings)),
        }
