from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

YearStatus = Literal["complete", "partial_year", "low_coverage", "no_data"]


class AnomalyMethod(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method_version: str = Field(description="Methodology identifier, e.g. temperature-anomaly-v1.")
    metric: str
    baseline_statistic: str
    anomaly_formula: str
    unit: str
    temperature_decimals: int = Field(description="Decimals applied to every returned temperature (°C).")
    coverage_decimals: int
    baseline_min_coverage: float
    year_min_coverage: float
    missing_value_policy: str
    incomplete_year_policy: str


class AnomalyBaseline(BaseModel):
    model_config = ConfigDict(extra="ignore")

    start_year: int
    end_year: int
    mean_daily_max_c: float = Field(description="Mean of all valid daily maximum temperatures in the baseline.")
    observation_count: int
    expected_count: int
    coverage: float
    low_coverage_years: list[int]


class AnnualAnomaly(BaseModel):
    model_config = ConfigDict(extra="ignore")

    year: int
    annual_mean_daily_max_c: float | None = Field(
        description="Mean of the year's valid daily maxima inside the requested window; null with no observations.")
    anomaly_c: float | None = Field(
        description="annual_mean_daily_max_c minus the baseline mean. Null unless status is 'complete'.")
    observation_count: int = Field(description="Valid daily observations used.")
    expected_count: int = Field(description="Days of this year inside the requested window.")
    coverage: float
    status: YearStatus
    warnings: list[str]


class AnomalySummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    years_in_window: int
    complete_years: int = Field(description="Years with an anomaly. This is the denominator of every mean below.")
    mean_anomaly_c: float | None
    mean_annual_daily_max_c: float | None
    max_anomaly_c: float | None
    max_anomaly_year: int | None
    min_anomaly_c: float | None
    min_anomaly_year: int | None
    positive_years: int
    negative_years: int
    zero_years: int


class AnomalyDataQuality(BaseModel):
    model_config = ConfigDict(extra="ignore")

    analysis_coverage: float
    missing_day_count: int
    warnings: list[str]


class TemperatureAnomalyResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    location_key: str
    analysis_type: str
    latitude: float
    longitude: float
    start_date: date
    end_date: date
    method: AnomalyMethod
    baseline: AnomalyBaseline
    annual: list[AnnualAnomaly]
    summary: AnomalySummary
    data_quality: AnomalyDataQuality
    source: str
    computed_at: datetime
