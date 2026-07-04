from sqlalchemy import text

from ..connectors.database_engine import get_engine


# Load Stored Average Speeds for all Segments of a Route.
def fetch_segment_speeds(route_id: str) -> dict:

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


# Update the Running Average Speed for a Route Segment.
def upsert_segment_speed(
    route_id:          str,
    from_stop_id:      str,
    to_stop_id:        str,
    trip_avg_speed:    float,
    trip_sample_count: int,
) -> None:

    if trip_sample_count <= 0:
        return

    sql = text(
        """
        INSERT INTO route_segment_speed
            (id, route_id, from_stop_id, to_stop_id, avg_speed_mps, sample_count, updated_at)
        VALUES
            (:id, :route_id, :from_stop_id, :to_stop_id, :avg, :n, now())
        ON CONFLICT (route_id, from_stop_id, to_stop_id) DO UPDATE SET
            avg_speed_mps = (
                route_segment_speed.avg_speed_mps * route_segment_speed.sample_count
                + EXCLUDED.avg_speed_mps * EXCLUDED.sample_count
            ) / (route_segment_speed.sample_count + EXCLUDED.sample_count),
            sample_count = route_segment_speed.sample_count + EXCLUDED.sample_count,
            updated_at = now()
        """
    )

    with get_engine().begin() as conn:
        conn.execute(
            sql,
            {
                "id":           f"rss_{route_id}_{from_stop_id}_{to_stop_id}",
                "route_id":     route_id,
                "from_stop_id": from_stop_id,
                "to_stop_id":   to_stop_id,
                "avg":          trip_avg_speed,
                "n":            trip_sample_count,
            },
        )
