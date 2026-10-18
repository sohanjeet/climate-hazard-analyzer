from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.weather import WeatherResponse
from app.services.weather_service import WeatherService, WeatherServiceError

router = APIRouter(prefix="/api", tags=["weather"])


@router.get("/weather", response_model=WeatherResponse)
def get_weather(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    start_date: date = Query(...),
    end_date: date = Query(...),
):
    try:
        return WeatherService().ingest(latitude, longitude, start_date, end_date)
    except WeatherServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"error": exc.message}) from exc
