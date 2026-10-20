"""Request middleware: in-memory rate limiting, request id, security header and duration logging."""

import logging
import math
import time
import uuid
from collections import deque
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.config import get_settings

logger = logging.getLogger("app.request")

# Only these paths are logged verbatim; anything else is logged as "unmatched" so a crafted URL
# cannot inject log lines.
KNOWN_PATHS = frozenset({"/", "/health", "/health/db", "/api/weather", "/api/heatwaves",
                         "/api/temperature-anomalies", "/api/geography/locations", "/api/geography/coverage",
                         "/docs", "/redoc", "/openapi.json"})
HEATWAVE_PATH = "/api/heatwaves"
ANOMALY_PATH = "/api/temperature-anomalies"


class RateLimiter:
    """Sliding-window limiter held in process memory.

    Fine for a single-process deployment. With several workers each keeps its own window, so
    the effective limit is multiplied by the worker count.
    """

    def __init__(self, window_seconds: float = 60.0, max_clients: int = 10_000,
                 clock: Callable[[], float] = time.monotonic):
        self.window = window_seconds
        self.max_clients = max_clients
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def reset(self) -> None:
        self._hits.clear()

    def check(self, key: str, limit: int) -> int | None:
        """Record a hit. Returns None if allowed, otherwise the seconds until a slot frees up."""
        now = self._clock()
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= self.max_clients:
                self._prune(now)
            hits = self._hits[key] = deque()
        cutoff = now - self.window
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, math.ceil(hits[0] + self.window - now))
        hits.append(now)
        return None

    def _prune(self, now: float) -> None:
        cutoff = now - self.window
        for key in [k for k, h in self._hits.items() if not h or h[-1] <= cutoff]:
            del self._hits[key]
        while len(self._hits) >= self.max_clients:  # still full of active clients: drop the oldest entry
            del self._hits[next(iter(self._hits))]


def _client_id(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip()  # the entry appended by our own proxy
    return request.client.host if request.client else "unknown"


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint):
        settings = get_settings()
        started = time.perf_counter()
        request_id = uuid.uuid4().hex[:16]
        path = request.url.path

        response = None
        if settings.rate_limit_enabled and path.startswith("/api/") and request.method != "OPTIONS":
            # Both analysis endpoints can trigger cold upstream ingestion, so each gets the stricter limit in
            # its own bucket (a comparison run calls both once per location).
            heavy = {HEATWAVE_PATH: "heatwaves", ANOMALY_PATH: "anomalies"}.get(path)
            limit = (settings.rate_limit_heatwave_requests_per_minute if heavy
                     else settings.rate_limit_requests_per_minute)
            bucket = f"{heavy or 'api'}:{_client_id(request, settings.trust_proxy_headers)}"
            retry_after = request.app.state.rate_limiter.check(bucket, limit)
            if retry_after is not None:
                response = JSONResponse(
                    status_code=429,
                    content={"detail": {"error": "Rate limit exceeded; retry later"}},
                    headers={"Retry-After": str(retry_after)},
                )
        if response is None:
            try:
                response = await call_next(request)
            except Exception as exc:  # last resort; never expose the message or traceback to the client
                logger.error("unhandled_error type=%s request_id=%s", type(exc).__name__, request_id)
                response = JSONResponse(status_code=500, content={"detail": {"error": "Internal server error"}})

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        # The query string is deliberately not logged: it carries coordinates.
        logger.info("request method=%s path=%s status=%d duration_ms=%.1f request_id=%s",
                    request.method, path if path in KNOWN_PATHS else "unmatched", response.status_code,
                    (time.perf_counter() - started) * 1000, request_id)
        return response
