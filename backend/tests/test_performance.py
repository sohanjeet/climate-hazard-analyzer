"""Bounded-concurrency regression tests (offline; threads, no real network or database)."""
import threading
import time
from datetime import date, timedelta
from unittest.mock import MagicMock

import httpx
import pytest

from app.config import Settings
from app.services.heatwave_service import HeatwaveService, year_chunks
from app.services.weather_service import WeatherService, WeatherServiceError, _KeyedLocks, location_key


class Gauge:
    """Tracks how many calls are running at once."""

    def __init__(self):
        self.lock = threading.Lock()
        self.running = self.peak = self.started = 0

    def enter(self):
        with self.lock:
            self.running += 1
            self.started += 1
            self.peak = max(self.peak, self.running)

    def leave(self):
        with self.lock:
            self.running -= 1


class FakeWeather:
    def __init__(self, gauge, delay=0.02, fail_on_year=None):
        self.gauge, self.delay, self.fail_on_year = gauge, delay, fail_on_year

    def ingest(self, latitude, longitude, start, end):
        self.gauge.enter()
        try:
            time.sleep(self.delay)
            if start.year == self.fail_on_year:
                raise WeatherServiceError("Open-Meteo request failed", 502)
            return {"records": [{"date": start, "temperature_max_c": float(start.year)}],
                    "missing_dates": [], "warnings": [f"year:{start.year}"]}
        finally:
            self.gauge.leave()


def heatwave_service(weather, concurrency):
    return HeatwaveService(MagicMock(), Settings(weather_fetch_concurrency=concurrency), weather_service=weather)


def test_year_chunks_loading_never_exceeds_the_configured_concurrency():
    gauge = Gauge()
    service = heatwave_service(FakeWeather(gauge), 3)
    series, missing, warnings = service._load_series(0.0, 0.0, date(1991, 1, 1), date(2020, 12, 31))
    assert gauge.started == 30
    assert 2 <= gauge.peak <= 3  # concurrent, but bounded


def test_results_are_merged_in_chunk_order_regardless_of_completion_order():
    class Jittery(FakeWeather):
        def ingest(self, latitude, longitude, start, end):
            time.sleep(0.03 if start.year % 2 else 0)  # odd years finish last
            return super().ingest(latitude, longitude, start, end)

    parallel = heatwave_service(Jittery(Gauge(), 0), 4)._load_series(0, 0, date(2000, 1, 1), date(2011, 12, 31))
    sequential = heatwave_service(FakeWeather(Gauge(), 0), 1)._load_series(0, 0, date(2000, 1, 1), date(2011, 12, 31))
    assert parallel == sequential
    assert parallel[2] == [f"year:{y}" for y in range(2000, 2012)]


def test_concurrency_one_runs_strictly_sequentially():
    gauge = Gauge()
    heatwave_service(FakeWeather(gauge), 1)._load_series(0, 0, date(2000, 1, 1), date(2009, 12, 31))
    assert gauge.peak == 1 and gauge.started == 10


def test_a_failing_chunk_stops_scheduling_further_requests():
    gauge = Gauge()
    service = heatwave_service(FakeWeather(gauge, delay=0.05, fail_on_year=1991), 2)
    with pytest.raises(WeatherServiceError, match="Open-Meteo request failed"):
        service._load_series(0, 0, date(1991, 1, 1), date(2020, 12, 31))
    assert gauge.started < 30  # pending chunks were cancelled instead of hammering a failing upstream
    assert gauge.running == 0  # and no worker is left running after the call returns


def test_single_chunk_does_not_spawn_a_pool():
    gauge = Gauge()
    heatwave_service(FakeWeather(gauge), 8)._load_series(0, 0, date(2023, 1, 1), date(2023, 12, 31))
    assert gauge.started == 1 and len(year_chunks(date(2023, 1, 1), date(2023, 12, 31))) == 1


def test_warm_series_uses_one_weather_records_query_for_the_whole_range():
    """A 30-year warm baseline must not fan out into 30 record/cache lookups."""
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: getattr(db, name)
    start, end = date(2010, 1, 1), date(2011, 12, 31)
    db.weather_records.find.return_value = [
        {"location_key": location_key(1, 2), "date": day, "temperature_max_c": 20.0}
        for day in (start + timedelta(days=i) for i in range((end - start).days + 1))
    ]
    weather = WeatherService(db, Settings(weather_fetch_concurrency=4))
    service = HeatwaveService(db, Settings(weather_fetch_concurrency=4), weather_service=weather)

    series, missing, warnings = service._load_series(1, 2, start, end)

    assert len(series) == 730 and not missing and not warnings
    assert db.weather_records.find.call_count == 1
    db.ingestion_cache.find_one.assert_not_called()


def test_concurrency_setting_is_validated():
    with pytest.raises(ValueError):
        Settings(weather_fetch_concurrency=0)
    with pytest.raises(ValueError):
        Settings(weather_fetch_concurrency=500)


def test_process_wide_cap_holds_across_simultaneous_requests():
    """Ten API requests at once must still keep at most N Open-Meteo calls in flight."""
    gauge = Gauge()

    class SlowClient:
        def get(self, url, params=None, timeout=None):
            gauge.enter()
            try:
                time.sleep(0.03)
                return httpx.Response(200, json={"daily": {"time": [], "temperature_2m_max": []}},
                                      request=httpx.Request("GET", url))
            finally:
                gauge.leave()

    settings = Settings(weather_fetch_concurrency=2)
    threads = [
        threading.Thread(target=WeatherService(MagicMock(), settings, http_client=SlowClient())._fetch,
                         args=(1, 2, date(2024, 1, 1), date(2024, 1, 2)))
        for _ in range(10)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert gauge.started == 10 and gauge.peak == 2


def test_keyed_lock_serialises_same_key_and_releases_entries():
    locks = _KeyedLocks()
    gauge, other = Gauge(), Gauge()

    def work(key, g):
        with locks.hold(key):
            g.enter()
            time.sleep(0.02)
            g.leave()

    threads = [threading.Thread(target=work, args=("same", gauge)) for _ in range(5)]
    threads += [threading.Thread(target=work, args=(f"other-{i}", other)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert gauge.peak == 1  # identical keys never overlap
    assert other.peak > 1  # different keys do
    assert locks._locks == {}  # no lock objects leak
