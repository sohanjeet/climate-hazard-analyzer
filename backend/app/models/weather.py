from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class WeatherRecordResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location_key: str
    date: date
    latitude: float
    longitude: float
    temperature_max_c: float
    source: str
    quality: dict[str, Any]
    fetched_at: datetime


class WeatherResponse(BaseModel):
    location_key: str | None
    start_date: date
    end_date: date
    records: list[WeatherRecordResponse]
    record_count: int
    complete: bool
    missing_dates: list[date]
    cache_hit: bool
    source: str
    warnings: list[str]
