from typing import Literal

from pydantic import BaseModel, ConfigDict

MetricName = Literal[
    "heatwave_frequency",
    "total_heatwave_days",
    "mean_duration_days",
    "max_intensity_c",
    "mean_intensity_c",
]
TrendClassification = Literal["increasing", "decreasing", "no_significant_trend", "insufficient_data"]
RollingStatus = Literal["ok", "year_unavailable", "gap_in_window", "insufficient_history"]


class TrendMethod(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method_version: str
    regression: str
    x_variable: str
    p_value_method: str
    significance_level: float
    min_observations: int
    low_power_observations: int
    included_years: str
    missing_value_policy: str
    zero_policy: str
    rolling_window_years: int
    rolling_alignment: str
    rolling_gap_policy: str


class RollingPoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    year: int
    value: float | None
    included: bool
    rolling_mean: float | None
    status: RollingStatus
    # Years inside the trailing window that are excluded or have no metric value.
    gap_years: list[int]


class RollingAverage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    window_years: int
    alignment: str
    valid_points: int
    points: list[RollingPoint]


class TrendMetric(BaseModel):
    model_config = ConfigDict(extra="ignore")

    metric: MetricName
    label: str
    unit: str
    classification: TrendClassification
    n_observations: int
    first_year: int | None
    last_year: int | None
    years_used: list[int]
    # Complete years that contribute no value: no events for event-derived metrics.
    missing_value_years: list[int]
    # Years left out because is_complete is false.
    excluded_incomplete_years: list[int]
    zero_value_observations: int
    irregular_spacing: bool
    slope_per_year: float | None
    slope_per_decade: float | None
    # Value of the fitted line at calendar year 0 (a mathematical constant, not a physical estimate).
    intercept: float | None
    r_squared: float | None
    p_value: float | None
    std_err: float | None
    p_value_supported: bool
    notes: list[str]
    rolling_average: RollingAverage


class TrendInsight(BaseModel):
    model_config = ConfigDict(extra="ignore")

    metric: MetricName
    classification: TrendClassification
    statement: str


class TrendAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method: TrendMethod
    complete_years_used: int
    first_complete_year: int | None
    last_complete_year: int | None
    metrics: list[TrendMetric]
    insights: list[TrendInsight]
    interpretation_note: str
    warnings: list[str]
