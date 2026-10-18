"""Cold vs warm benchmark of one heatwave analysis against the real Open-Meteo archive.

Uses a throwaway MongoDB database (dropped afterwards), so nothing in the configured application
database is touched. One run makes about 31 Open-Meteo requests (30 baseline years + the
analysis year). Run from the backend directory:

    venv\\Scripts\\python -m scripts.benchmark_live --lat 28.6139 --lon 77.2090 --concurrency 1 4
"""

import argparse
import json
import statistics
import threading
import time
import uuid
from datetime import date

from pymongo import MongoClient

from app import database
from app.config import Settings, get_settings
from app.services.heatwave_service import HeatwaveService
from app.services.weather_service import WeatherService, close_http_client


def run_once(lat: float, lon: float, concurrency: int, analysis_year: int) -> dict:
    base = get_settings()
    client = MongoClient(base.mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=3000)
    name = f"bench_{uuid.uuid4().hex[:10]}"
    db = client[name]
    database.ensure_indexes(db)

    calls: list[float] = []
    peak = {"now": 0, "max": 0}
    lock = threading.Lock()
    original = WeatherService._fetch

    def timed_fetch(self, *args):
        with lock:
            peak["now"] += 1
            peak["max"] = max(peak["max"], peak["now"])
        started = time.perf_counter()
        try:
            return original(self, *args)
        finally:
            with lock:
                peak["now"] -= 1
                calls.append(time.perf_counter() - started)

    WeatherService._fetch = timed_fetch
    close_http_client()
    try:
        settings = Settings(weather_fetch_concurrency=concurrency)
        service = HeatwaveService(db, settings)
        args = (lat, lon, date(analysis_year, 1, 1), date(analysis_year, 12, 31))

        started = time.perf_counter()
        cold = service.analyze(*args)
        cold_s = time.perf_counter() - started
        cold_calls, cold_peak = len(calls), peak["max"]

        warm_times = []
        for _ in range(3):
            started = time.perf_counter()
            warm = service.analyze(*args)
            warm_times.append(time.perf_counter() - started)
        return {
            "concurrency": concurrency,
            "cold_seconds": round(cold_s, 2),
            "upstream_requests": cold_calls,
            "peak_in_flight": cold_peak,
            "mean_upstream_request_seconds": round(statistics.mean(calls[:cold_calls]), 2),
            "max_upstream_request_seconds": round(max(calls[:cold_calls]), 2),
            "warm_seconds": [round(t, 3) for t in warm_times],
            "warm_upstream_requests": len(calls) - cold_calls,
            "weather_records_stored": db["weather_records"].count_documents({}),
            "threshold_c": round(cold["baseline"]["threshold_c"], 3),
            "total_events": cold["summary"]["total_events"],
            "warm_matches_cold": (warm["baseline"] == cold["baseline"] and warm["summary"] == cold["summary"]
                                  and warm["events"] == cold["events"] and warm["trend"] == cold["trend"]),
        }
    finally:
        WeatherService._fetch = original
        close_http_client()
        client.drop_database(name)
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, default=28.6139)
    parser.add_argument("--lon", type=float, default=77.2090)
    parser.add_argument("--year", type=int, default=2023, help="analysis year (baseline is the default 1991-2020)")
    parser.add_argument("--concurrency", type=int, nargs="+", default=[1, 4])
    parser.add_argument("--pause", type=float, default=10.0, help="seconds to wait between runs")
    options = parser.parse_args()
    for index, level in enumerate(options.concurrency):
        if index:
            time.sleep(options.pause)
        print(json.dumps(run_once(options.lat, options.lon, level, options.year)), flush=True)
