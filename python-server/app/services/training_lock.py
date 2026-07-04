import zlib
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Connection


def _lock_key(route_id: str) -> int:
    return zlib.crc32(route_id.encode("utf-8")) & 0x7FFFFFFF


# Non-Blocking, Per-Route Training Lock.
@contextmanager
def try_route_training_lock(conn: Connection, route_id: str) -> Iterator[bool]:
    key = _lock_key(route_id)
    acquired = conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}).scalar()
    try:
        yield bool(acquired)
    finally:
        if acquired:
            conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
