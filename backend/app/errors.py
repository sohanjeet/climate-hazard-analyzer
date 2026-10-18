"""Consistent JSON errors: every error body is ``{"detail": {"error": "<message>", ...}}``."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import ConnectionFailure, ExecutionTimeout
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.database import DatabaseUnavailableError

logger = logging.getLogger("app.errors")

MAX_REPORTED_FIELD_ERRORS = 10


def _database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    # Log the type only: driver messages can include host names or connection details.
    logger.error("database_unavailable type=%s", type(exc).__name__)
    return JSONResponse(
        status_code=503,
        content={"detail": {"error": "Database temporarily unavailable"}},
        headers={"Retry-After": "5"},
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field and message only; the rejected input value is not echoed back.
        errors = [
            {"field": ".".join(str(part) for part in err["loc"][1:]) or str(err["loc"][0]), "message": err["msg"]}
            for err in exc.errors()[:MAX_REPORTED_FIELD_ERRORS]
        ]
        return JSONResponse(status_code=422, content={"detail": {"error": "Invalid request parameters", "errors": errors}})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)

    app.add_exception_handler(ConnectionFailure, _database_unavailable)
    app.add_exception_handler(ExecutionTimeout, _database_unavailable)
    app.add_exception_handler(DatabaseUnavailableError, _database_unavailable)
