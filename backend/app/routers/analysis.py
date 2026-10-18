from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.schemas.analysis import HeatwaveAnalysisResponse
from app.services.heatwave_service import HeatwaveService, HeatwaveServiceError
from app.services.weather_service import WeatherServiceError

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get("/heatwaves", response_model=HeatwaveAnalysisResponse)
def get_heatwaves(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    start_date: date = Query(...),
    end_date: date = Query(...),
    baseline_start_year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
    baseline_end_year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
    rolling_window_years: Annotated[int | None, Query(ge=2, le=30)] = None,
):
    try:
        return HeatwaveService().analyze(
            latitude, longitude, start_date, end_date, baseline_start_year, baseline_end_year,
            rolling_window_years,
        )
    except (HeatwaveServiceError, WeatherServiceError) as exc:
        raise HTTPException(status_code=exc.status_code, detail={"error": exc.message}) from exc
