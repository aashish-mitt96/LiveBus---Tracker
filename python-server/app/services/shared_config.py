from sqlalchemy import text

from ..config import DEFAULT_SPEED_MPS as _ENV_DEFAULT_SPEED_MPS
from ..connectors.database_engine import get_engine
from . import route_cache

_CACHE_KEY = "config:default_eta_speed_mps"
_CACHE_TTL_SECONDS = 60.0


def get_default_speed_mps() -> float:
    cached = route_cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    value = _ENV_DEFAULT_SPEED_MPS
    try:
        sql = text("SELECT value FROM service_config WHERE key = 'default_eta_speed_mps'")
        with get_engine().connect() as conn:
            row = conn.execute(sql).fetchone()
        if row is not None:
            value = float(row.value)
    except Exception:
        pass

    route_cache.set(_CACHE_KEY, value, ttl_seconds=_CACHE_TTL_SECONDS)
    return value
