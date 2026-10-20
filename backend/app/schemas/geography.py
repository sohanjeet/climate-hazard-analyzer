from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Scope = Literal["observation_location"]


class ObservationLocationOut(BaseModel):
    id: str = Field(description="Stable identifier, e.g. in-rj-jaipur.")
    name: str
    latitude: float
    longitude: float
    country_code: str = Field(description="ISO 3166-1 alpha-3.")
    country_name: str
    region_code: str | None = Field(description="ISO 3166-2:IN code for Indian locations, otherwise null.")
    region_name: str | None
    role: Literal["capital", "major_city"] = Field(
        description="Why this point represents its territory: the capital, or a major city when the capital lies outside it."
    )
    role_note: str | None


class LocationsResponse(BaseModel):
    scope: Scope = Field(description="Always observation_location: values for these points are never area aggregates.")
    scope_note: str
    count: int
    locations: list[ObservationLocationOut]


class LocationCoverage(BaseModel):
    location_id: str
    baseline_stored_days: int
    baseline_expected_days: int
    window_stored_days: int
    window_expected_days: int
    status: Literal["stored", "partial", "not_stored"]


class CoverageResponse(BaseModel):
    scope: Scope
    start_date: date
    end_date: date
    baseline_start_year: int
    baseline_end_year: int
    status_note: str
    locations: list[LocationCoverage]
