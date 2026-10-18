import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import database
from app.config import get_settings
from app.errors import register_exception_handlers
from app.logging_config import configure_logging
from app.middleware import RateLimiter, RequestContextMiddleware
from app.routers.analysis import router as analysis_router
from app.routers.anomaly import router as anomaly_router
from app.routers.weather import router as weather_router
from app.services.weather_service import close_http_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast if MongoDB is unreachable at startup (the error carries no connection details).
    # Once running, pymongo reconnects by itself and outages surface as 503 responses.
    database.connect()
    try:
        database.ensure_indexes(database.get_db())
        yield
    finally:
        close_http_client()
        database.close()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Climate Hazard Trend Analyzer API",
        description="Historical weather and heatwave analysis",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.rate_limiter = RateLimiter()
    register_exception_handlers(app)

    origins = settings.cors_origins
    if "*" in origins:
        logger.warning("CORS_ALLOWED_ORIGINS contains '*': any website can call this API from a browser")
    # Added last = outermost, so CORS headers are also present on 429 and 500 responses.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
        expose_headers=["Retry-After", "X-Request-ID"],
        max_age=600,
    )
    app.include_router(weather_router)
    app.include_router(analysis_router)
    app.include_router(anomaly_router)

    @app.get("/")
    def root():
        return {"message": "Climate Hazard Analyzer API"}

    @app.get("/health")
    def health_check():
        return {"status": "healthy"}

    @app.get("/health/db")
    def db_health_check():
        if database.ping():
            return {"status": "healthy"}
        return JSONResponse(status_code=503, content={"status": "unavailable"})

    return app


app = create_app()
