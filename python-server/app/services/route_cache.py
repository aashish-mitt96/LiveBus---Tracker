import threading
import time
from typing import Any, Dict, Optional, Tuple


_lock = threading.RLock()
_cache: Dict[str, Tuple[float, Any]] = {}


def get(key: str) -> Optional[Any]:
    with _lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            _cache.pop(key, None)
            return None
        return value


def set(key: str, value: Any, ttl_seconds: float) -> None:
    with _lock:
        _cache[key] = (time.monotonic() + ttl_seconds, value)


def invalidate(key: str) -> None:
    with _lock:
        _cache.pop(key, None)
