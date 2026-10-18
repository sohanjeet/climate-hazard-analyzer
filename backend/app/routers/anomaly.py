from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.schemas.anomaly import TemperatureAnomalyResponse
from app.services.anomaly_service import AnomalyService
from app.services.heatwave_service import HeatwaveServiceError
from app.services.weather_service import WeatherServiceError

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get(
    "/temperature-anomalies",
    response_model=TemperatureAnomalyResponse,
    summary="Annual temperature anomalies against a fixed baseline",
    description=(
        "For each year in the window: annual mean daily maximum temperature minus the mean daily maximum "
        "over the baseline period (default 1991-2020). Years that are not complete (partial year or too "
        "many missing days) report their mean but no anomaly. Errors: 422 invalid input or insufficient "
        "baseline data, 429 rate limited, 502/503/504 upstream or database problems."
    ),
)
def get_temperature_anomalies(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    start_date: date = Query(...),
    end_date: date = Query(...),
    baseline_start_year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
    baseline_end_year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
):
    try:
        return AnomalyService().analyze(
            latitude, longitude, start_date, end_date, baseline_start_year, baseline_end_year,
        )
    except (HeatwaveServiceError, WeatherServiceError) as exc:
        raise HTTPException(status_code=exc.status_code, detail={"error": exc.message}) from exc
