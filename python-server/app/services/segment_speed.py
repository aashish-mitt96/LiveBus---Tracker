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

    select_sql = text(
        """
        SELECT avg_speed_mps, sample_count
        FROM route_segment_speed
        WHERE route_id = :route_id
          AND from_stop_id = :from_stop_id
          AND to_stop_id = :to_stop_id
        """
    )

    with get_engine().begin() as conn:

        # Check Whether this Segment Exists.
        existing = conn.execute(
            select_sql,
            {
                "route_id":     route_id,
                "from_stop_id": from_stop_id,
                "to_stop_id":   to_stop_id,
            },
        ).fetchone()

        if existing:

            # Compute the New Weighted Average.
            old_n   = existing.sample_count
            new_n   = old_n + trip_sample_count
            new_avg = ( existing.avg_speed_mps * old_n + trip_avg_speed * trip_sample_count ) / new_n

            conn.execute(
                text(
                    """
                    UPDATE route_segment_speed
                    SET avg_speed_mps = :avg,
                        sample_count = :n,
                        updated_at = now()
                    WHERE route_id = :route_id
                      AND from_stop_id = :from_stop_id
                      AND to_stop_id = :to_stop_id
                    """
                ),
                {
                    "avg":          new_avg,
                    "n":            new_n,
                    "route_id":     route_id,
                    "from_stop_id": from_stop_id,
                    "to_stop_id":   to_stop_id,
                },
            )
        else:
            # Insert a New Route Segment Speed record.
            conn.execute(
                text(
                    """
                    INSERT INTO route_segment_speed
                    (id, route_id, from_stop_id, to_stop_id, avg_speed_mps, sample_count)
                    VALUES
                    (:id, :route_id, :from_stop_id, :to_stop_id, :avg, :n)
                    """
                ),
                {
                    "id":           f"rss_{route_id}_{from_stop_id}_{to_stop_id}",
                    "route_id":     route_id,
                    "from_stop_id": from_stop_id,
                    "to_stop_id":   to_stop_id,
                    "avg":          trip_avg_speed,
                    "n":            trip_sample_count,
                },
            )