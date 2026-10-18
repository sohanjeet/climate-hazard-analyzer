"""Climate trend analysis of annual heatwave metrics (method ``trend-v1``).

Ordinary least squares regression of each annual metric on calendar year,
using only years with ``is_complete=true``. Missing metric values (for example
mean duration in a year with no events) are left out, never replaced by zero or
interpolated; genuine zeros (no events, zero heatwave days) are kept. Rolling
averages are trailing windows of consecutive calendar years and are never
computed across an excluded or missing year. See README "Trend analysis".
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

from scipy import stats

from app.schemas.trend import TrendAnalysis

METHOD_VERSION = "trend-v1"
MIN_ROLLING_WINDOW = 2
MAX_ROLLING_WINDOW = 30

INTERPRETATION_NOTE = (
    "Trends describe linear change in this single grid-cell series over the analysed years. "
    "A statistically significant trend is an association within these data; it does not by itself "
    "establish the cause of the change, and the absence of a significant trend does not show that no "
    "change occurred. P-values assume independent, roughly normal residuals and are not adjusted for "
    "testing several metrics, so they should be read as indicative."
)


class TrendServiceError(ValueError):
    pass


@dataclass(frozen=True)
class MetricSpec:
    name: str
    label: str
    unit: str
    field: str
    # True when the value is undefined (None) in a year without heatwave events.
    event_derived: bool


METRICS: tuple[MetricSpec, ...] = (
    MetricSpec("heatwave_frequency", "Heatwave frequency", "events", "heatwave_count", False),
    MetricSpec("total_heatwave_days", "Total heatwave days", "days", "total_heatwave_days", False),
    MetricSpec("mean_duration_days", "Mean heatwave duration", "days", "mean_duration_days", True),
    MetricSpec("max_intensity_c", "Maximum heatwave intensity", "°C above threshold", "max_intensity_c", True),
    MetricSpec("mean_intensity_c", "Mean heatwave intensity", "°C above threshold", "mean_intensity_c", True),
)


def validate_rolling_window(window: int) -> int:
    if isinstance(window, bool) or not isinstance(window, int):
        raise TrendServiceError("rolling window must be an integer number of years")
    if not MIN_ROLLING_WINDOW <= window <= MAX_ROLLING_WINDOW:
        raise TrendServiceError(
            f"rolling window must be between {MIN_ROLLING_WINDOW} and {MAX_ROLLING_WINDOW} years"
        )
    return window


# --------------------------------------------------------------------------- pure functions


def _number(value: Any) -> float | None:
    """A finite float, or None for missing / non-numeric / NaN / infinite values. Zero stays zero."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clean(value: float | None) -> float | None:
    """Plain float; turns -0.0 into 0.0 and non-finite values into None so results stay JSON safe."""
    if value is None:
        return None
    value = float(value)
    return value + 0.0 if math.isfinite(value) else None


def _is_constant(values: Sequence[float]) -> bool:
    spread = max(values) - min(values)
    return spread <= 1e-12 * max(1.0, abs(sum(values) / len(values)))


def linear_trend(
    years: Sequence[int],
    values: Sequence[float],
    alpha: float = 0.05,
    min_observations: int = 3,
    low_power_observations: int = 10,
) -> dict[str, Any]:
    """OLS of ``values`` on calendar ``years`` (irregular spacing is handled by using the real years).

    The p-value is the two-sided t-test of slope = 0 from ``scipy.stats.linregress`` (n - 2 degrees
    of freedom). It is reported only when the series has enough points and is not constant.
    """
    n = len(years)
    result: dict[str, Any] = {
        "classification": "insufficient_data",
        "slope_per_year": None,
        "slope_per_decade": None,
        "intercept": None,
        "r_squared": None,
        "p_value": None,
        "std_err": None,
        "p_value_supported": False,
        "notes": [],
    }
    notes: list[str] = result["notes"]
    if len(values) != n:
        raise TrendServiceError("years and values must have the same length")
    if len(set(years)) != n:
        raise TrendServiceError("years must be unique")
    if n < max(min_observations, 3):
        notes.append("fewer_than_min_observations")
        return result

    if _is_constant(values):
        result.update(
            classification="no_significant_trend",
            slope_per_year=0.0,
            slope_per_decade=0.0,
            intercept=_clean(values[0]),
        )
        notes.append("constant_series")
        return result

    fit = stats.linregress([float(y) for y in years], [float(v) for v in values])
    slope, intercept, r_squared = _clean(fit.slope), _clean(fit.intercept), _clean(fit.rvalue ** 2)
    p_value, std_err = _clean(fit.pvalue), _clean(fit.stderr)
    if None in (slope, intercept, r_squared, p_value, std_err):
        notes.append("non_finite_regression_result")
        return result

    if p_value < alpha:
        classification = "increasing" if slope > 0 else "decreasing"
    else:
        classification = "no_significant_trend"
    result.update(
        classification=classification,
        slope_per_year=slope,
        slope_per_decade=_clean(slope * 10),
        intercept=intercept,
        r_squared=r_squared,
        p_value=p_value,
        std_err=std_err,
        p_value_supported=True,
    )
    if n < low_power_observations:
        notes.append("low_statistical_power")
    return result


def rolling_average(
    year_values: Mapping[int, float | None],
    first_year: int,
    last_year: int,
    window: int,
) -> dict[str, Any]:
    """Trailing mean over ``window`` consecutive calendar years ending at each year.

    ``year_values`` holds only usable years (complete and with a value); every other calendar year in
    [first_year, last_year] is a gap. A mean is produced only when all ``window`` years are usable, so
    a gap is never bridged and is listed in ``gap_years``.
    """
    validate_rolling_window(window)
    points: list[dict[str, Any]] = []
    valid = 0
    for year in range(first_year, last_year + 1):
        value = year_values.get(year)
        window_years = range(year - window + 1, year + 1)
        gap_years = [y for y in window_years if y >= first_year and year_values.get(y) is None]
        mean: float | None = None
        if value is None:
            status = "year_unavailable"
        elif year - window + 1 < first_year:
            status = "insufficient_history"
        elif gap_years:
            status = "gap_in_window"
        else:
            status = "ok"
            mean = _clean(math.fsum(year_values[y] for y in window_years) / window)  # type: ignore[misc]
            valid += 1
        points.append({
            "year": year,
            "value": _clean(value),
            "included": value is not None,
            "rolling_mean": mean,
            "status": status,
            "gap_years": gap_years,
        })
    return {"window_years": window, "alignment": "trailing", "valid_points": valid, "points": points}


def _fmt_p(p: float) -> str:
    return "p < 0.001" if p < 0.001 else f"p = {p:.3f}"


def _insight(spec: MetricSpec, metric: dict[str, Any], alpha: float, min_observations: int) -> dict[str, Any]:
    classification = metric["classification"]
    n = metric["n_observations"]
    span = f"{metric['first_year']}-{metric['last_year']}"
    if classification == "insufficient_data":
        statement = (
            f"{spec.label}: insufficient data. {n} usable complete-year observation(s); "
            f"at least {max(min_observations, 3)} are needed for a trend estimate."
        )
    elif "constant_series" in metric["notes"]:
        statement = (
            f"{spec.label}: constant across {n} complete years ({span}); the slope is 0 "
            f"and no p-value applies."
        )
    elif classification == "no_significant_trend":
        statement = (
            f"{spec.label}: no statistically significant linear trend at the {alpha:g} level "
            f"({metric['slope_per_decade']:+.2f} {spec.unit} per decade, {_fmt_p(metric['p_value'])}, "
            f"n = {n}, {span}). This does not show that no change occurred."
        )
    else:
        direction = "increase" if classification == "increasing" else "decrease"
        statement = (
            f"{spec.label}: statistically significant linear {direction} of "
            f"{abs(metric['slope_per_decade']):.2f} {spec.unit} per decade "
            f"({_fmt_p(metric['p_value'])}, R² = {metric['r_squared']:.2f}, n = {n}, {span}). "
            f"This is an association within this series and does not establish its cause."
        )
    return {"metric": spec.name, "classification": classification, "statement": statement}


def compute_trends(
    annual: Sequence[Mapping[str, Any]],
    rolling_window_years: int = 5,
    alpha: float = 0.05,
    min_observations: int = 3,
    low_power_observations: int = 10,
    extra_warnings: Iterable[str] = (),
) -> dict[str, Any]:
    """Trend results for the annual heatwave rows as a JSON-serialisable dict (validated by TrendAnalysis)."""
    validate_rolling_window(rolling_window_years)
    if not 0 < alpha < 1:
        raise TrendServiceError("significance level must be between 0 and 1")

    rows: dict[int, Mapping[str, Any]] = {}
    for row in annual:
        year = int(row["year"])
        if year in rows:
            raise TrendServiceError(f"duplicate annual row for year {year}")
        rows[year] = row
    all_years = sorted(rows)
    complete_years = [y for y in all_years if rows[y].get("is_complete") is True]
    incomplete_years = [y for y in all_years if y not in complete_years]

    warnings = set(extra_warnings)
    if len(complete_years) < max(min_observations, 3):
        warnings.add(f"fewer_than_{max(min_observations, 3)}_complete_years")
    if incomplete_years:
        warnings.add("incomplete_years_excluded")

    metrics: list[dict[str, Any]] = []
    insights: list[dict[str, Any]] = []
    for spec in METRICS:
        usable: dict[int, float | None] = {}
        missing_value_years: list[int] = []
        for year in complete_years:
            value = _number(rows[year].get(spec.field))
            if value is None:
                missing_value_years.append(year)
            else:
                usable[year] = value
        years = sorted(usable)
        values = [usable[y] for y in years]  # type: ignore[misc]

        fit = linear_trend(years, values, alpha, min_observations, low_power_observations)  # type: ignore[arg-type]
        notes = list(fit["notes"])
        if incomplete_years:
            notes.append("incomplete_years_excluded")
        if missing_value_years:
            notes.append("event_years_only" if spec.event_derived else "missing_metric_values_excluded")
        irregular = any(b - a != 1 for a, b in zip(years, years[1:]))
        if irregular:
            notes.append("irregular_year_spacing")

        rolling = rolling_average(usable, all_years[0], all_years[-1], rolling_window_years) if all_years else {
            "window_years": rolling_window_years, "alignment": "trailing", "valid_points": 0, "points": [],
        }
        metric = {
            "metric": spec.name,
            "label": spec.label,
            "unit": spec.unit,
            "n_observations": len(years),
            "first_year": years[0] if years else None,
            "last_year": years[-1] if years else None,
            "years_used": years,
            "missing_value_years": missing_value_years,
            "excluded_incomplete_years": incomplete_years,
            "zero_value_observations": sum(1 for v in values if v == 0),
            "irregular_spacing": irregular,
            **fit,
            "notes": notes,
            "rolling_average": rolling,
        }
        metrics.append(metric)
        insights.append(_insight(spec, metric, alpha, min_observations))

    analysis = {
        "method": {
            "method_version": METHOD_VERSION,
            "regression": "ordinary_least_squares",
            "x_variable": "calendar_year",
            "p_value_method": "two_sided_t_test_on_slope_scipy_linregress",
            "significance_level": alpha,
            "min_observations": max(min_observations, 3),
            "low_power_observations": low_power_observations,
            "included_years": "is_complete_only",
            "missing_value_policy": "excluded_not_imputed",
            "zero_policy": "zero_counts_retained",
            "rolling_window_years": rolling_window_years,
            "rolling_alignment": "trailing",
            "rolling_gap_policy": "no_bridging_gaps_marked",
        },
        "complete_years_used": len(complete_years),
        "first_complete_year": complete_years[0] if complete_years else None,
        "last_complete_year": complete_years[-1] if complete_years else None,
        "metrics": metrics,
        "insights": insights,
        "interpretation_note": INTERPRETATION_NOTE,
        "warnings": sorted(warnings),
    }
    return TrendAnalysis.model_validate(analysis).model_dump(mode="python")
