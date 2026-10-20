"""Curated observation locations for the map pages (docs/geospatial_architecture.md, section 5).

Each location is one point. Analyses describe the reanalysis grid cell nearest to it, never a country or state
aggregate. India has one location per state and union territory: the capital where it lies inside that territory,
otherwise a major city (with the reason in ``role_note``). Coordinates are city centres to four decimals; the four
dashboard presets (Delhi, Mumbai, Bengaluru, Chennai) use exactly the same values as the frontend so stored data is
shared.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RegionType = Literal["state", "union_territory"]
Role = Literal["capital", "major_city"]

# ISO 3166-2:IN, current codes (ISO replaced IN-CT, IN-OR, IN-TG and IN-UT in 2023). Mirrors
# frontend/src/lib/geo/india-regions.json.
INDIA_REGIONS: dict[str, tuple[str, RegionType]] = {
    "IN-AN": ("Andaman and Nicobar Islands", "union_territory"),
    "IN-AP": ("Andhra Pradesh", "state"),
    "IN-AR": ("Arunachal Pradesh", "state"),
    "IN-AS": ("Assam", "state"),
    "IN-BR": ("Bihar", "state"),
    "IN-CH": ("Chandigarh", "union_territory"),
    "IN-CG": ("Chhattisgarh", "state"),
    "IN-DH": ("Dadra and Nagar Haveli and Daman and Diu", "union_territory"),
    "IN-DL": ("Delhi", "union_territory"),
    "IN-GA": ("Goa", "state"),
    "IN-GJ": ("Gujarat", "state"),
    "IN-HR": ("Haryana", "state"),
    "IN-HP": ("Himachal Pradesh", "state"),
    "IN-JK": ("Jammu and Kashmir", "union_territory"),
    "IN-JH": ("Jharkhand", "state"),
    "IN-KA": ("Karnataka", "state"),
    "IN-KL": ("Kerala", "state"),
    "IN-LA": ("Ladakh", "union_territory"),
    "IN-LD": ("Lakshadweep", "union_territory"),
    "IN-MP": ("Madhya Pradesh", "state"),
    "IN-MH": ("Maharashtra", "state"),
    "IN-MN": ("Manipur", "state"),
    "IN-ML": ("Meghalaya", "state"),
    "IN-MZ": ("Mizoram", "state"),
    "IN-NL": ("Nagaland", "state"),
    "IN-OD": ("Odisha", "state"),
    "IN-PY": ("Puducherry", "union_territory"),
    "IN-PB": ("Punjab", "state"),
    "IN-RJ": ("Rajasthan", "state"),
    "IN-SK": ("Sikkim", "state"),
    "IN-TN": ("Tamil Nadu", "state"),
    "IN-TS": ("Telangana", "state"),
    "IN-TR": ("Tripura", "state"),
    "IN-UP": ("Uttar Pradesh", "state"),
    "IN-UK": ("Uttarakhand", "state"),
    "IN-WB": ("West Bengal", "state"),
}


@dataclass(frozen=True)
class ObservationLocation:
    id: str
    name: str
    latitude: float
    longitude: float
    country_code: str  # ISO 3166-1 alpha-3
    country_name: str
    region_code: str | None  # ISO 3166-2:IN for Indian locations
    role: Role
    role_note: str | None = None

    @property
    def region_name(self) -> str | None:
        return INDIA_REGIONS[self.region_code][0] if self.region_code else None


CHANDIGARH_NOTE = "The state capital, Chandigarh, is a separate union territory, so a major city inside the state is used."
COASTAL_NOTE = "Coastal or island point: the nearest reanalysis grid cell may be partly sea."


def _in(code: str, slug: str, name: str, lat: float, lon: float, role: Role = "capital",
        note: str | None = None) -> ObservationLocation:
    return ObservationLocation(f"{code.lower()}-{slug}", name, lat, lon, "IND", "India", code, role, note)


INDIA_LOCATIONS: tuple[ObservationLocation, ...] = (
    _in("IN-AN", "sri-vijaya-puram", "Sri Vijaya Puram (Port Blair)", 11.6234, 92.7265, note=COASTAL_NOTE),
    _in("IN-AP", "amaravati", "Amaravati", 16.5131, 80.5165),
    _in("IN-AR", "itanagar", "Itanagar", 27.0844, 93.6053),
    _in("IN-AS", "dispur", "Dispur", 26.1433, 91.7898),
    _in("IN-BR", "patna", "Patna", 25.5941, 85.1376),
    _in("IN-CH", "chandigarh", "Chandigarh", 30.7333, 76.7794),
    _in("IN-CG", "raipur", "Raipur", 21.2514, 81.6296),
    _in("IN-DH", "daman", "Daman", 20.3974, 72.8328, note=COASTAL_NOTE),
    _in("IN-DL", "delhi", "Delhi", 28.6139, 77.209),
    _in("IN-GA", "panaji", "Panaji", 15.4909, 73.8278, note=COASTAL_NOTE),
    _in("IN-GJ", "gandhinagar", "Gandhinagar", 23.2156, 72.6369),
    _in("IN-HR", "hisar", "Hisar", 29.1492, 75.7217, "major_city", CHANDIGARH_NOTE),
    _in("IN-HP", "shimla", "Shimla", 31.1048, 77.1734),
    _in("IN-JK", "srinagar", "Srinagar", 34.0837, 74.7973, note="Summer capital; Jammu is the winter capital."),
    _in("IN-JH", "ranchi", "Ranchi", 23.3441, 85.3096),
    _in("IN-KA", "bengaluru", "Bengaluru", 12.9716, 77.5946),
    _in("IN-KL", "thiruvananthapuram", "Thiruvananthapuram", 8.5241, 76.9366, note=COASTAL_NOTE),
    _in("IN-LA", "leh", "Leh", 34.1526, 77.5771),
    _in("IN-LD", "kavaratti", "Kavaratti", 10.5669, 72.642, note=COASTAL_NOTE),
    _in("IN-MP", "bhopal", "Bhopal", 23.2599, 77.4126),
    _in("IN-MH", "mumbai", "Mumbai", 19.076, 72.8777, note=COASTAL_NOTE),
    _in("IN-MN", "imphal", "Imphal", 24.817, 93.9368),
    _in("IN-ML", "shillong", "Shillong", 25.5788, 91.8933),
    _in("IN-MZ", "aizawl", "Aizawl", 23.7271, 92.7176),
    _in("IN-NL", "kohima", "Kohima", 25.6751, 94.1086),
    _in("IN-OD", "bhubaneswar", "Bhubaneswar", 20.2961, 85.8245),
    _in("IN-PY", "puducherry", "Puducherry", 11.9416, 79.8083, note=COASTAL_NOTE),
    _in("IN-PB", "ludhiana", "Ludhiana", 30.901, 75.8573, "major_city", CHANDIGARH_NOTE),
    _in("IN-RJ", "jaipur", "Jaipur", 26.9124, 75.7873),
    _in("IN-SK", "gangtok", "Gangtok", 27.3389, 88.6065),
    _in("IN-TN", "chennai", "Chennai", 13.0827, 80.2707, note=COASTAL_NOTE),
    _in("IN-TS", "hyderabad", "Hyderabad", 17.385, 78.4867),
    _in("IN-TR", "agartala", "Agartala", 23.8315, 91.2868),
    _in("IN-UP", "lucknow", "Lucknow", 26.8467, 80.9462),
    _in("IN-UK", "dehradun", "Dehradun", 30.3165, 78.0322, note="Winter capital; Gairsain (Bhararisain) is the summer capital."),
    _in("IN-WB", "kolkata", "Kolkata", 22.5726, 88.3639),
)


def _world(code: str, country: str, slug: str, name: str, lat: float, lon: float, role: Role,
           note: str | None = None) -> ObservationLocation:
    return ObservationLocation(f"{code.lower()}-{slug}", name, lat, lon, code, country, None, role, note)


WORLD_LOCATIONS: tuple[ObservationLocation, ...] = (
    _world("ARE", "United Arab Emirates", "dubai", "Dubai", 25.2048, 55.2708, "major_city", COASTAL_NOTE),
    _world("ARG", "Argentina", "buenos-aires", "Buenos Aires", -34.6037, -58.3816, "capital"),
    _world("AUS", "Australia", "sydney", "Sydney", -33.8688, 151.2093, "major_city", COASTAL_NOTE),
    _world("BGD", "Bangladesh", "dhaka", "Dhaka", 23.8103, 90.4125, "capital"),
    _world("BRA", "Brazil", "sao-paulo", "São Paulo", -23.5505, -46.6333, "major_city"),
    _world("CAN", "Canada", "toronto", "Toronto", 43.6532, -79.3832, "major_city"),
    _world("CHN", "China", "beijing", "Beijing", 39.9042, 116.4074, "capital"),
    _world("DEU", "Germany", "berlin", "Berlin", 52.52, 13.405, "capital"),
    _world("EGY", "Egypt", "cairo", "Cairo", 30.0444, 31.2357, "capital"),
    _world("ESP", "Spain", "madrid", "Madrid", 40.4168, -3.7038, "capital"),
    _world("FRA", "France", "paris", "Paris", 48.8566, 2.3522, "capital"),
    _world("GBR", "United Kingdom", "london", "London", 51.5074, -0.1278, "capital"),
    _world("IDN", "Indonesia", "jakarta", "Jakarta", -6.2088, 106.8456, "major_city", COASTAL_NOTE),
    _world("ITA", "Italy", "rome", "Rome", 41.9028, 12.4964, "capital"),
    _world("JPN", "Japan", "tokyo", "Tokyo", 35.6762, 139.6503, "capital"),
    _world("KEN", "Kenya", "nairobi", "Nairobi", -1.2921, 36.8219, "capital"),
    _world("LKA", "Sri Lanka", "colombo", "Colombo", 6.9271, 79.8612, "major_city", COASTAL_NOTE),
    _world("MEX", "Mexico", "mexico-city", "Mexico City", 19.4326, -99.1332, "capital"),
    _world("NGA", "Nigeria", "lagos", "Lagos", 6.5244, 3.3792, "major_city", COASTAL_NOTE),
    _world("NPL", "Nepal", "kathmandu", "Kathmandu", 27.7172, 85.324, "capital"),
    _world("PAK", "Pakistan", "karachi", "Karachi", 24.8607, 67.0011, "major_city", COASTAL_NOTE),
    _world("RUS", "Russia", "moscow", "Moscow", 55.7558, 37.6173, "capital"),
    _world("SAU", "Saudi Arabia", "riyadh", "Riyadh", 24.7136, 46.6753, "capital"),
    _world("THA", "Thailand", "bangkok", "Bangkok", 13.7563, 100.5018, "capital"),
    _world("USA", "United States", "new-york", "New York", 40.7128, -74.006, "major_city", COASTAL_NOTE),
    _world("USA", "United States", "phoenix", "Phoenix", 33.4484, -112.074, "major_city"),
    _world("ZAF", "South Africa", "johannesburg", "Johannesburg", -26.2041, 28.0473, "major_city"),
)

LOCATIONS: tuple[ObservationLocation, ...] = INDIA_LOCATIONS + WORLD_LOCATIONS
