import logging

from pymongo import ASCENDING, MongoClient
from pymongo.database import Database
from pymongo.errors import OperationFailure, PyMongoError

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

WEATHER_RECORDS = "weather_records"
ANALYSIS_RESULTS = "analysis_results"
INGESTION_CACHE = "ingestion_cache"

_client: MongoClient | None = None


class DatabaseUnavailableError(RuntimeError):
    """The database is not connected or cannot be reached right now."""


def connect(settings: Settings | None = None) -> MongoClient:
    """Create the shared client and verify the server is reachable.

    Failures are re-raised without the original message, since pymongo errors
    can echo the connection string.
    """
    global _client
    if _client is not None:
        return _client
    settings = settings or get_settings()
    client = MongoClient(
        settings.mongodb_uri.get_secret_value(),
        serverSelectionTimeoutMS=settings.mongodb_server_selection_timeout_ms,
        maxPoolSize=settings.mongodb_max_pool_size,
        connectTimeoutMS=settings.mongodb_connect_timeout_ms,
        socketTimeoutMS=settings.mongodb_socket_timeout_ms,
        waitQueueTimeoutMS=settings.mongodb_wait_queue_timeout_ms,
        appname="climate-hazard-analyzer",
    )
    try:
        client.admin.command("ping")
    except PyMongoError as exc:
        client.close()
        logger.error("MongoDB connection failed (%s)", type(exc).__name__)
        raise RuntimeError("Could not connect to MongoDB; check MONGODB_URI and network access") from None
    _client = client
    logger.info("Connected to MongoDB database '%s'", settings.database_name)
    return _client


def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
        logger.info("MongoDB connection closed")


def get_client() -> MongoClient:
    if _client is None:
        raise DatabaseUnavailableError("MongoDB is not connected")
    return _client


def get_db(settings: Settings | None = None) -> Database:
    settings = settings or get_settings()
    return get_client()[settings.database_name]


def ping() -> bool:
    try:
        get_client().admin.command("ping")
        return True
    except (PyMongoError, RuntimeError):  # DatabaseUnavailableError is a RuntimeError
        return False


def ensure_indexes(db: Database) -> None:
    """Create indexes. Idempotent; safe to run on every startup.

    Document shape assumed by these indexes:
      weather_records:  location_key, date (datetime), latitude, longitude, ...
      analysis_results: location_key, analysis_type, start_date, end_date, params_hash, created_at
      ingestion_cache:  cache_key, expires_at (datetime)
    """
    # One record per location per day; also serves location + date-range queries.
    db[WEATHER_RECORDS].create_index(
        [("location_key", ASCENDING), ("date", ASCENDING)],
        unique=True,
        name="uniq_location_date",
    )
    db[WEATHER_RECORDS].create_index([("date", ASCENDING)], name="date")

    db[ANALYSIS_RESULTS].create_index(
        [
            ("location_key", ASCENDING),
            ("analysis_type", ASCENDING),
            ("start_date", ASCENDING),
            ("end_date", ASCENDING),
        ],
        name="location_type_range",
    )
    # The upsert key used by HeatwaveService._save. Without uniqueness, two concurrent first
    # requests for the same key could each insert a document.
    try:
        db[ANALYSIS_RESULTS].create_index(
            [
                ("location_key", ASCENDING),
                ("analysis_type", ASCENDING),
                ("start_date", ASCENDING),
                ("end_date", ASCENDING),
                ("params_hash", ASCENDING),
            ],
            unique=True,
            name="uniq_analysis_key",
        )
    except OperationFailure as exc:
        # Pre-existing duplicates would block the unique index; keep serving rather than fail startup.
        logger.warning("Could not create unique analysis index (code=%s); duplicates may exist", exc.code)
    db[ANALYSIS_RESULTS].create_index([("created_at", ASCENDING)], name="created_at")

    # Lookup key, plus TTL so expired cache entries are removed by MongoDB.
    db[INGESTION_CACHE].create_index([("cache_key", ASCENDING)], unique=True, name="uniq_cache_key")
    db[INGESTION_CACHE].create_index([("expires_at", ASCENDING)], expireAfterSeconds=0, name="ttl_expires_at")
