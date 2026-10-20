from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.schemas.geography import CoverageResponse, LocationsResponse
from app.services.geography_service import GeographyService, GeographyServiceError

router = APIRouter(prefix="/api/geography", tags=["geography"])

Country = Annotated[str | None, Query(min_length=3, max_length=3, description="ISO 3166-1 alpha-3, e.g. IND.")]
Region = Annotated[str | None, Query(min_length=5, max_length=5, description="ISO 3166-2:IN, e.g. IN-RJ.")]


@router.get(
    "/locations",
    response_model=LocationsResponse,
    summary="Supported observation locations",
    description=(
        "The curated points the map pages can analyse, optionally filtered by country or Indian state/UT. Each point "
        "is analysed as the single reanalysis grid cell nearest to it; nothing here is a country or state aggregate. "
        "A valid country without locations returns an empty list."
    ),
)
def get_locations(country: Country = None, region: Region = None):
    try:
        return GeographyService().locations(country, region)
    except GeographyServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"error": exc.message}) from exc


@router.get(
    "/coverage",
    response_model=CoverageResponse,
    summary="Stored-data coverage of the observation locations",
    description=(
        "For each matching location, how many days of the baseline and of the window are already stored. Read-only: "
        "never downloads data and computes no climate metric. Same date rules as the analysis endpoints."
    ),
)
def get_coverage(
    start_date: date = Query(...),
    end_date: date = Query(...),
    country: Country = None,
    region: Region = None,
):
    try:
        return GeographyService().coverage(start_date, end_date, country, region)
    except GeographyServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"error": exc.message}) from exc
