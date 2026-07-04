"""
Direct Postgres access. We read route/route_stop (Node owns those tables,
we only ever SELECT from them) and fully own route_segment_speed
(read + write). Raw SQL with explicit quoting is used instead of ORM models
because a couple of Node/Drizzle columns are camelCase-quoted identifiers
("routeId", "tripId") — easiest to just be explicit about it.
"""
from typing import List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import DATABASE_URL
from .geo import RouteStopPoint

_engine: Optional[Engine] = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    return _engine


def fetch_route_stops(route_id: str) -> List[RouteStopPoint]:
    sql = text(
        """
        SELECT id, seq, stop_name, lat, lng
        FROM route_stop
        WHERE route_id = :route_id
        ORDER BY seq ASC
        """
    )
    with get_engine().connect() as conn:
        rows = conn.execute(sql, {"route_id": route_id}).fetchall()
    return [RouteStopPoint(id=r.id, seq=r.seq, stop_name=r.stop_name, lat=r.lat, lng=r.lng) for r in rows]


def fetch_trip_route_id(trip_id: str) -> Optional[str]:
    sql = text('SELECT route_id FROM trip WHERE "tripId" = :trip_id')
    with get_engine().connect() as conn:
        row = conn.execute(sql, {"trip_id": trip_id}).fetchone()
    return row.route_id if row else None


def fetch_segment_speeds(route_id: str) -> dict:
    """Returns {(from_stop_id, to_stop_id): avg_speed_mps}."""
    sql = text(
        """
        SELECT from_stop_id, to_stop_id, avg_speed_mps
        FROM route_segment_speed
        WHERE route_id = :route_id
        """
    )
    with get_engine().connect() as conn:
        rows = conn.execute(sql, {"route_id": route_id}).fetchall()
    return {(r.from_stop_id, r.to_stop_id): r.avg_speed_mps for r in rows}


def upsert_segment_speed(route_id: str, from_stop_id: str, to_stop_id: str, trip_avg_speed: float, trip_sample_count: int) -> None:
    """Merge this trip's observed segment speed into the running average."""
    if trip_sample_count <= 0:
        return

    select_sql = text(
        """
        SELECT avg_speed_mps, sample_count FROM route_segment_speed
        WHERE route_id = :route_id AND from_stop_id = :from_stop_id AND to_stop_id = :to_stop_id
        """
    )
    with get_engine().begin() as conn:
        existing = conn.execute(
            select_sql, {"route_id": route_id, "from_stop_id": from_stop_id, "to_stop_id": to_stop_id}
        ).fetchone()

        if existing:
            old_n = existing.sample_count
            new_n = old_n + trip_sample_count
            new_avg = (existing.avg_speed_mps * old_n + trip_avg_speed * trip_sample_count) / new_n
            conn.execute(
                text(
                    """
                    UPDATE route_segment_speed
                    SET avg_speed_mps = :avg, sample_count = :n, updated_at = now()
                    WHERE route_id = :route_id AND from_stop_id = :from_stop_id AND to_stop_id = :to_stop_id
                    """
                ),
                {"avg": new_avg, "n": new_n, "route_id": route_id, "from_stop_id": from_stop_id, "to_stop_id": to_stop_id},
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO route_segment_speed (id, route_id, from_stop_id, to_stop_id, avg_speed_mps, sample_count)
                    VALUES (:id, :route_id, :from_stop_id, :to_stop_id, :avg, :n)
                    """
                ),
                {
                    "id": f"rss_{route_id}_{from_stop_id}_{to_stop_id}",
                    "route_id": route_id,
                    "from_stop_id": from_stop_id,
                    "to_stop_id": to_stop_id,
                    "avg": trip_avg_speed,
                    "n": trip_sample_count,
                },
            )