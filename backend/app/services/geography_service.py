"""Read-only geography support: the observation-location catalog and how much of its data is already stored.

Nothing here calls Open-Meteo or computes a climate metric. Coverage counts stored daily records, so it tells the
UI whether an analysis would run from the database (fast) or download data first (slow); whether the values are
valid is still decided by the analysis endpoints' own coverage rules.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from app import database
from app.config import Settings, get_settings
from app.services.geography_catalog import INDIA_REGIONS, LOCATIONS, ObservationLocation
from app.services.heatwave_service import HeatwaveService, HeatwaveServiceError
from app.services.weather_service import _to_datetime, location_key

SCOPE = "observation_location"
SCOPE_NOTE = (
    "Each location is the reanalysis grid cell nearest its coordinates. "
    "Values are location-level observations, not country or state aggregates."
)
COVERAGE_MAX_TIME_MS = 5000

_COUNTRY = re.compile(r"^[A-Z]{3}$")
_REGION = re.compile(r"^IN-[A-Z]{2}$")


class GeographyServiceError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _days(start: date, end: date) -> int:
    return (end - start).days + 1


def location_view(location: ObservationLocation) -> dict[str, Any]:
    return {
        "id": location.id,
        "name": location.name,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "country_code": location.country_code,
        "country_name": location.country_name,
        "region_code": location.region_code,
        "region_name": location.region_name,
        "role": location.role,
        "role_note": location.role_note,
    }


class GeographyService:
    def __init__(self, db: Any | None = None, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.db = db

    def _db(self):
        return self.db if self.db is not None else database.get_db(self.settings)

    def select(self, country: str | None = None, region: str | None = None) -> list[ObservationLocation]:
        if country is not None and not _COUNTRY.match(country):
            raise GeographyServiceError("country must be an ISO 3166-1 alpha-3 code such as IND")
        if region is not None:
            if not _REGION.match(region) or region not in INDIA_REGIONS:
                raise GeographyServiceError("region must be the ISO 3166-2:IN code of a current Indian state or union territory")
            if country not in (None, "IND"):
                raise GeographyServiceError("region can only be combined with country IND")
        return [
            loc for loc in LOCATIONS
            if (country is None or loc.country_code == country) and (region is None or loc.region_code == region)
        ]

    def locations(self, country: str | None = None, region: str | None = None) -> dict[str, Any]:
        selected = self.select(country, region)
        return {"scope": SCOPE, "scope_note": SCOPE_NOTE, "count": len(selected),
                "locations": [location_view(loc) for loc in selected]}

    def coverage(self, start: date, end: date, country: str | None = None, region: str | None = None) -> dict[str, Any]:
        s = self.settings
        b_start, b_end = s.heatwave_baseline_start_year, s.heatwave_baseline_end_year
        try:
            # Same date rules as the analysis endpoints; the coordinates are irrelevant here.
            HeatwaveService(self.db, s).validate_request(0.0, 0.0, start, end, b_start, b_end)
        except HeatwaveServiceError as exc:
            raise GeographyServiceError(exc.message, exc.status_code) from None
        selected = self.select(country, region)
        baseline_from, baseline_to = date(b_start, 1, 1), date(b_end, 12, 31)
        counts = self._stored_counts(selected, start, end, baseline_from, baseline_to)

        baseline_expected, window_expected = _days(baseline_from, baseline_to), _days(start, end)
        rows = []
        for loc in selected:
            stored = counts.get(location_key(loc.latitude, loc.longitude), {"baseline": 0, "window": 0})
            complete = stored["baseline"] == baseline_expected and stored["window"] == window_expected
            empty = stored["baseline"] == 0 and stored["window"] == 0
            rows.append({
                "location_id": loc.id,
                "baseline_stored_days": stored["baseline"],
                "baseline_expected_days": baseline_expected,
                "window_stored_days": stored["window"],
                "window_expected_days": window_expected,
                "status": "stored" if complete else "not_stored" if empty else "partial",
            })
        return {
            "scope": SCOPE,
            "start_date": start,
            "end_date": end,
            "baseline_start_year": b_start,
            "baseline_end_year": b_end,
            "status_note": (
                "stored: every day of the baseline and the window is in the database, so an analysis needs no "
                "download. partial: some days are stored (the archive itself can have gaps). not_stored: an analysis "
                "downloads the data first. This is about storage, not about whether results are valid."
            ),
            "locations": rows,
        }

    def _stored_counts(self, selected: list[ObservationLocation], start: date, end: date,
                       baseline_from: date, baseline_to: date) -> dict[str, dict[str, int]]:
        if not selected:
            return {}
        keys = sorted({location_key(loc.latitude, loc.longitude) for loc in selected})

        def inside(lo: date, hi: date) -> dict[str, Any]:
            return {"$cond": [{"$and": [{"$gte": ["$date", _to_datetime(lo)]}, {"$lte": ["$date", _to_datetime(hi)]}]}, 1, 0]}

        # One pass over the (location_key, date) index. The explicit projection of only the indexed fields lets
        # MongoDB answer from the index without fetching any document (a covered query).
        pipeline = [
            {"$match": {
                "location_key": {"$in": keys},
                "date": {"$gte": _to_datetime(min(start, baseline_from)), "$lte": _to_datetime(max(end, baseline_to))},
            }},
            {"$project": {"_id": 0, "location_key": 1, "date": 1}},
            {"$group": {"_id": "$location_key", "baseline": {"$sum": inside(baseline_from, baseline_to)},
                        "window": {"$sum": inside(start, end)}}},
        ]
        cursor = self._db()[database.WEATHER_RECORDS].aggregate(
            pipeline, maxTimeMS=COVERAGE_MAX_TIME_MS, hint="uniq_location_date")
        return {doc["_id"]: {"baseline": int(doc["baseline"]), "window": int(doc["window"])} for doc in cursor}
