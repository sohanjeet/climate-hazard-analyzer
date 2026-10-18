import logging

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


class _StripQueryString(logging.Filter):
    """uvicorn's access log prints the full request target; drop the query so coordinates are not logged."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=level.upper(), format=_FORMAT)
    else:
        root.setLevel(level.upper())
    # httpx logs every request URL at INFO, and the URL carries the coordinates.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _StripQueryString) for f in access.filters):
        access.addFilter(_StripQueryString())
