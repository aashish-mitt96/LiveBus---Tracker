from sqlalchemy import text
from typing import List, Optional

from ..services.route_geometry import RouteStopPoint
from ..connectors.database_engine import get_engine


# Fetch all Stops for a Route in Travel Order.
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

    return [
        RouteStopPoint(
            id        = r.id,
            seq       = r.seq,
            stop_name = r.stop_name,
            lat       = r.lat,
            lng       = r.lng,
        )
        for r in rows
    ]


# Get the Route Associated with a Trip.
def fetch_trip_route_id(trip_id: str) -> Optional[str]:

    sql = text('SELECT route_id FROM trip WHERE "tripId" = :trip_id')

    with get_engine().connect() as conn:
        row = conn.execute(sql, {"trip_id": trip_id}).fetchone()

    return row.route_id if row else None
