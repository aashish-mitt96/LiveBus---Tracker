import re

from fastapi import HTTPException

_ROUTE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_route_id(route_id: str) -> None:
    if not route_id or not _ROUTE_ID_RE.match(route_id):
        raise HTTPException(400, f"Invalid route_id: {route_id!r}")
