from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # SecretStr keeps the URI (which may embed credentials) out of repr/logs.
    mongodb_uri: SecretStr = SecretStr("mongodb://localhost:27017")
    database_name: str = "climate_hazard_db"
    mongodb_server_selection_timeout_ms: int = 5000
    mongodb_max_pool_size: int = 20
    mongodb_connect_timeout_ms: int = 5000
    mongodb_socket_timeout_ms: int = 30000
    mongodb_wait_queue_timeout_ms: int = 5000
    open_meteo_base_url: str = "https://archive-api.open-meteo.com/v1/archive"
    open_meteo_timeout_seconds: float = 10.0
    open_meteo_connect_timeout_seconds: float = 5.0
    # Retries apply only to transient failures (timeouts, network errors, 429, 5xx).
    open_meteo_max_retries: int = Field(2, ge=0, le=5)
    open_meteo_backoff_base_seconds: float = Field(0.5, ge=0)
    open_meteo_backoff_max_seconds: float = Field(8.0, ge=0)
    # Upper bound on simultaneous Open-Meteo requests across the whole process.
    weather_fetch_concurrency: int = Field(4, ge=1, le=8)
    cors_allowed_origins: str = "http://localhost:5173"  # comma-separated list
    rate_limit_enabled: bool = True
    rate_limit_requests_per_minute: int = Field(60, ge=1)
    rate_limit_heatwave_requests_per_minute: int = Field(20, ge=1)
    # Only enable behind a trusted reverse proxy; the header is otherwise client-controlled.
    trust_proxy_headers: bool = False
    log_level: str = "INFO"
    weather_max_range_days: int = 366
    weather_cache_ttl_seconds: int = 86400
    weather_archive_start_date: str = "1940-01-01"
    weather_archive_lag_days: int = 5
    heatwave_baseline_start_year: int = 1991
    heatwave_baseline_end_year: int = 2020
    heatwave_min_baseline_years: int = 10
    heatwave_percentile: float = 95.0
    heatwave_min_duration_days: int = 3
    heatwave_baseline_min_coverage: float = 0.90
    heatwave_year_min_coverage: float = 0.95
    heatwave_max_analysis_years: int = 90
    trend_rolling_window_years: int = 5
    trend_significance_level: float = 0.05
    trend_min_observations: int = 3
    trend_low_power_observations: int = 10

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
