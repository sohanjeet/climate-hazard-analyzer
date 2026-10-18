from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.trend import TrendAnalysis


class HeatwaveMethod(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method_version: str
    threshold_method: str
    percentile: float
    interpolation: str
    comparison: str
    min_duration_days: int
    missing_day_policy: str
    year_attribution: str
    intensity_reference: str
    baseline_min_coverage: float
    year_min_coverage: float


class BaselineInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    start_year: int
    end_year: int
    percentile: float
    threshold_c: float
    observation_count: int
    expected_count: int
    coverage: float
    exceedance_count: int
    low_coverage_years: list[int]


class HeatwaveEventResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    start_date: date
    end_date: date
    duration_days: int
    year: int
    peak_temperature_c: float
    mean_temperature_c: float
    max_exceedance_c: float
    mean_exceedance_c: float
    cumulative_exceedance_c: float
    censored_start: bool
    censored_end: bool
    adjacent_missing: bool


class AnnualHeatwaveMetrics(BaseModel):
    model_config = ConfigDict(extra="ignore")

    year: int
    days_expected: int
    days_observed: int
    coverage: float
    is_complete: bool
    heatwave_count: int
    total_heatwave_days: int
    mean_duration_days: float | None
    max_duration_days: int | None
    max_intensity_c: float | None
    mean_intensity_c: float | None
    peak_temperature_c: float | None


class HeatwaveSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total_events: int
    total_heatwave_days: int
    complete_years: int
    events_per_complete_year: float | None
    heatwave_days_per_complete_year: float | None
    mean_duration_days: float | None
    max_duration_days: int | None
    max_intensity_c: float | None
    mean_intensity_c: float | None
    peak_temperature_c: float | None


class DataQuality(BaseModel):
    model_config = ConfigDict(extra="ignore")

    analysis_coverage: float
    missing_dates: list[date]
    warnings: list[str]


class HeatwaveAnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location_key: str
    analysis_type: str
    latitude: float
    longitude: float
    start_date: date
    end_date: date
    method: HeatwaveMethod
    params_hash: str
    baseline: BaselineInfo
    events: list[HeatwaveEventResponse]
    annual: list[AnnualHeatwaveMetrics]
    summary: HeatwaveSummary
    # Added in Phase 5; optional so older stored results and clients keep validating.
    trend: TrendAnalysis | None = None
    data_quality: DataQuality
    source: str
    computed_at: datetime
