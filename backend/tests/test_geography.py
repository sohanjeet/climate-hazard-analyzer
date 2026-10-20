"""Geography catalog and endpoints: catalog integrity, validation, coverage maths, no upstream access."""

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import database
from app.config import get_settings
from app.services.geography_catalog import INDIA_LOCATIONS, INDIA_REGIONS, LOCATIONS
from app.services.geography_service import GeographyService, GeographyServiceError
from app.services.weather_service import WeatherService, location_key

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"

# frontend/src/lib/comparison.ts PRESET_LOCATIONS: identical coordinates mean identical location keys, so the map
# pages reuse data stored by the dashboard and the city comparison.
PRESETS = {"Delhi": (28.6139, 77.209), "Mumbai": (19.076, 72.8777), "Bengaluru": (12.9716, 77.5946),
           "Chennai": (13.0827, 80.2707)}


# ----------------------------------------------------------------------------------------------- catalog integrity

def test_india_has_exactly_one_location_per_current_state_and_union_territory():
    assert len(INDIA_REGIONS) == 36
    assert sum(1 for _, kind in INDIA_REGIONS.values() if kind == "state") == 28
    assert sorted(loc.region_code for loc in INDIA_LOCATIONS) == sorted(INDIA_REGIONS)
    # Codes ISO replaced in 2023 must not reappear; the merged and split territories are present.
    assert not {"IN-CT", "IN-OR", "IN-TG", "IN-UT", "IN-DD", "IN-DN"} & set(INDIA_REGIONS)
    assert {"IN-LA", "IN-DH", "IN-TS"} <= set(INDIA_REGIONS)


def test_catalog_entries_are_unique_and_well_formed():
    ids = [loc.id for loc in LOCATIONS]
    assert len(ids) == len(set(ids))
    keys = [location_key(loc.latitude, loc.longitude) for loc in LOCATIONS]
    assert len(keys) == len(set(keys)), "two catalog entries would share one grid point"
    for loc in LOCATIONS:
        assert -90 <= loc.latitude <= 90 and -180 <= loc.longitude <= 180
        assert len(loc.country_code) == 3 and loc.country_code.isupper()
        assert (loc.region_code is not None) == (loc.country_code == "IND")
        assert loc.role in ("capital", "major_city")
        if loc.role == "major_city" and loc.region_code:
            assert loc.role_note, f"{loc.id} must explain why it is not the capital"


def test_presets_share_coordinates_with_the_dashboard():
    by_name = {loc.name: loc for loc in INDIA_LOCATIONS}
    for name, (lat, lon) in PRESETS.items():
        assert (by_name[name].latitude, by_name[name].longitude) == (lat, lon)


def test_backend_registry_mirrors_the_frontend_registry():
    path = FRONTEND / "lib" / "geo" / "india-regions.json"
    if not path.exists():
        pytest.skip("frontend sources not present")
    frontend = {r["code"]: (r["name"], r["type"]) for r in json.loads(path.read_text(encoding="utf-8"))}
    assert frontend == INDIA_REGIONS


# Point-in-polygon against the shipped TopoJSON, so a mistyped coordinate cannot put a city in the wrong state.

def _decode_arcs(topology):
    scale, translate = topology["transform"]["scale"], topology["transform"]["translate"]
    arcs = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        arcs.append(points)
    return arcs


def _ring(arcs, indexes):
    points = []
    for index in indexes:
        arc = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
        points.extend(arc if not points else arc[1:])
    return points


def _polygons(geometry):
    return [geometry["arcs"]] if geometry["type"] == "Polygon" else geometry["arcs"]


def _inside_ring(lon, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _contains(arcs, geometry, lon, lat):
    for polygon in _polygons(geometry):
        outer, *holes = (_ring(arcs, r) for r in polygon)
        if _inside_ring(lon, lat, outer) and not any(_inside_ring(lon, lat, h) for h in holes):
            return True
    return False


def _distance_to_geometry_deg(arcs, geometry, lon, lat):
    best = float("inf")
    for polygon in _polygons(geometry):
        for ring in (_ring(arcs, r) for r in polygon):
            best = min(best, *(((x - lon) ** 2 + (y - lat) ** 2) ** 0.5 for x, y in ring))
    return best


def _load(name):
    path = FRONTEND / "data" / "geo" / name
    if not path.exists():
        pytest.skip("frontend boundary files not present")
    topology = json.loads(path.read_text(encoding="utf-8"))
    (geometries,) = [obj["geometries"] for obj in topology["objects"].values()]
    return _decode_arcs(topology), geometries


def test_every_indian_location_lies_in_its_state_or_ut():
    arcs, geometries = _load("india-states.topo.json")
    by_code = {g["id"]: g for g in geometries}
    assert sorted(by_code) == sorted(INDIA_REGIONS)
    for loc in INDIA_LOCATIONS:
        geometry = by_code[loc.region_code]
        others = [code for code, g in by_code.items() if code != loc.region_code and _contains(arcs, g, loc.longitude, loc.latitude)]
        assert others == [], f"{loc.id} lies in {others}"
        if not _contains(arcs, geometry, loc.longitude, loc.latitude):
            # Simplified coastlines can shave a shoreline city just outside; allow ~3 km, never a wrong state.
            assert _distance_to_geometry_deg(arcs, geometry, loc.longitude, loc.latitude) < 0.03, loc.id


# The world layer drops detached parts under 150 km2 (build-geo.mjs); Lakshadweep's islands total about 32 km2.
# Its point is checked against the detailed India layer above instead.
BELOW_WORLD_MAP_RESOLUTION = {"in-ld-kavaratti"}


def test_every_location_country_exists_on_the_world_map_and_contains_it():
    arcs, geometries = _load("world-countries.topo.json")
    by_iso = {g["properties"]["iso3"]: g for g in geometries if g["properties"]["iso3"]}
    for loc in LOCATIONS:
        assert loc.country_code in by_iso, loc.id
        others = [iso for iso, g in by_iso.items() if iso != loc.country_code and _contains(arcs, g, loc.longitude, loc.latitude)]
        assert others == [], f"{loc.id} lies in {others}"
        geometry = by_iso[loc.country_code]
        if loc.id in BELOW_WORLD_MAP_RESOLUTION or _contains(arcs, geometry, loc.longitude, loc.latitude):
            continue
        # World coastlines are generalised by up to ~20 km, so a shoreline city may sit just offshore.
        assert _distance_to_geometry_deg(arcs, geometry, loc.longitude, loc.latitude) < 0.15, loc.id


# ----------------------------------------------------------------------------------------------- locations endpoint

def test_locations_endpoint_filters_and_labels_the_scope(make_client):
    client = make_client()
    everything = client.get("/api/geography/locations").json()
    assert everything["count"] == len(LOCATIONS) == len(everything["locations"])
    assert everything["scope"] == "observation_location" and "not country or state aggregates" in everything["scope_note"]

    india = client.get("/api/geography/locations", params={"country": "IND"}).json()
    assert india["count"] == 36

    jaipur = client.get("/api/geography/locations", params={"region": "IN-RJ"}).json()
    assert [loc["name"] for loc in jaipur["locations"]] == ["Jaipur"]
    assert jaipur["locations"][0] == {
        "id": "in-rj-jaipur", "name": "Jaipur", "latitude": 26.9124, "longitude": 75.7873, "country_code": "IND",
        "country_name": "India", "region_code": "IN-RJ", "region_name": "Rajasthan", "role": "capital", "role_note": None,
    }


def test_country_without_locations_is_an_empty_list_not_an_error(make_client):
    response = make_client().get("/api/geography/locations", params={"country": "ISL"})
    assert response.status_code == 200
    assert response.json()["count"] == 0 and response.json()["locations"] == []


@pytest.mark.parametrize("params", [
    {"country": "ind"}, {"country": "IN"}, {"country": "INDI"}, {"country": "1ND"},
    {"region": "IN-XX"}, {"region": "IN-TG"}, {"region": "in-rj"}, {"region": "IN-RJ", "country": "USA"},
])
def test_invalid_filters_are_rejected(make_client, params):
    response = make_client().get("/api/geography/locations", params=params)
    assert response.status_code == 422
    assert "error" in response.json()["detail"]


def test_locations_use_the_general_rate_limit_bucket(make_client):
    client = make_client(rate_limit_requests_per_minute=2)
    assert [client.get("/api/geography/locations").status_code for _ in range(3)] == [200, 200, 429]
    # The heavy analysis bucket is separate (rejected by validation, so no database access is needed).
    assert client.get("/api/heatwaves", params={"latitude": 999}).status_code == 422


# ----------------------------------------------------------------------------------------------- coverage

@pytest.fixture
def live_db():
    client = MongoClient(get_settings().mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=3000)
    try:
        client.admin.command("ping")
    except PyMongoError:
        client.close()
        pytest.skip("MongoDB not reachable")
    name = f"test_{uuid.uuid4().hex[:12]}"
    db = client[name]
    database.ensure_indexes(db)
    yield db
    client.drop_database(name)
    client.close()


def _store(db, loc, start, end):
    docs = []
    day = start
    while day <= end:
        docs.append({"location_key": location_key(loc.latitude, loc.longitude),
                     "date": datetime(day.year, day.month, day.day, tzinfo=timezone.utc), "temperature_max_c": 30.0})
        day += timedelta(days=1)
    db[database.WEATHER_RECORDS].insert_many(docs)


def _by_name(name):
    return next(loc for loc in LOCATIONS if loc.name == name)


def test_coverage_status_counts_stored_days_without_downloading(live_db, monkeypatch):
    def no_upstream(*_args, **_kwargs):
        raise AssertionError("coverage must not download data")

    monkeypatch.setattr(WeatherService, "_fetch", no_upstream)
    jaipur, patna, leh = _by_name("Jaipur"), _by_name("Patna"), _by_name("Leh")
    _store(live_db, jaipur, date(1991, 1, 1), date(2021, 12, 31))  # baseline and window complete
    _store(live_db, patna, date(1991, 1, 1), date(2020, 12, 31))  # baseline only
    _store(live_db, leh, date(2021, 1, 1), date(2021, 1, 10))  # ten window days
    live_db[database.WEATHER_RECORDS].delete_one({"location_key": location_key(jaipur.latitude, jaipur.longitude),
                                                  "date": datetime(1995, 6, 1, tzinfo=timezone.utc)})

    result = GeographyService(live_db).coverage(date(2021, 1, 1), date(2021, 12, 31), country="IND")
    rows = {row["location_id"]: row for row in result["locations"]}
    assert len(rows) == 36
    assert rows[jaipur.id] == {"location_id": jaipur.id, "baseline_stored_days": 10958 - 1, "baseline_expected_days": 10958,
                               "window_stored_days": 365, "window_expected_days": 365, "status": "partial"}
    assert rows[patna.id]["status"] == "partial" and rows[patna.id]["window_stored_days"] == 0
    assert rows[leh.id]["window_stored_days"] == 10 and rows[leh.id]["baseline_stored_days"] == 0
    assert rows[_by_name("Delhi").id]["status"] == "not_stored"

    _store(live_db, jaipur, date(1995, 6, 1), date(1995, 6, 1))
    again = GeographyService(live_db).coverage(date(2021, 1, 1), date(2021, 12, 31), region="IN-RJ")
    assert [row["status"] for row in again["locations"]] == ["stored"]


def test_coverage_window_inside_the_baseline_counts_both(live_db):
    jaipur = _by_name("Jaipur")
    _store(live_db, jaipur, date(2000, 1, 1), date(2000, 12, 31))
    (row,) = GeographyService(live_db).coverage(date(2000, 1, 1), date(2000, 12, 31), region="IN-RJ")["locations"]
    assert row["window_stored_days"] == 366 and row["baseline_stored_days"] == 366


@pytest.mark.parametrize("start, end, fragment", [
    (date(2020, 1, 2), date(2020, 1, 1), "on or before"),
    (date(1930, 1, 1), date(2020, 12, 31), "historical archive"),
    (date(1920, 1, 1), date.today() + timedelta(days=30), "historical archive"),
])
def test_coverage_uses_the_analysis_date_rules(start, end, fragment):
    with pytest.raises(GeographyServiceError) as caught:
        GeographyService(db=object()).coverage(start, end)
    assert caught.value.status_code == 422 and fragment in caught.value.message


def test_coverage_endpoint(live_db, monkeypatch):
    monkeypatch.setenv("DATABASE_NAME", live_db.name)
    get_settings.cache_clear()
    try:
        from app.main import app
        with TestClient(app) as client:
            params = {"start_date": "2021-01-01", "end_date": "2021-12-31", "region": "IN-DL"}
            response = client.get("/api/geography/coverage", params=params)
            assert response.status_code == 200
            body = response.json()
            assert body["scope"] == "observation_location" and body["baseline_start_year"] == 1991
            assert body["locations"][0]["status"] == "not_stored"
            assert client.get("/api/geography/coverage", params={**params, "region": "IN-XX"}).status_code == 422
            assert client.get("/api/geography/coverage", params={"start_date": "2021-01-01"}).status_code == 422
            # Read-only: nothing was written.
            assert live_db[database.WEATHER_RECORDS].count_documents({}) == 0
            assert live_db[database.ANALYSIS_RESULTS].count_documents({}) == 0
    finally:
        get_settings.cache_clear()
