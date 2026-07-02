from typing import Optional
from ..connectors.database import get_pool


# Fetch the route ID & Ordered Route Stops for a Trip.
async def get_trip_route_and_stops(trip_id: str) -> Optional[dict]:

    pool = get_pool()

    async with pool.acquire() as conn:
        # Get the route associated with the trip.
        trip_row = await conn.fetchrow(
            'SELECT route_id FROM trip WHERE "tripId" = $1',
            trip_id
        )
        if not trip_row:
            return None
        route_id = trip_row["route_id"]

        # Fetch all route stops in travel order.
        stop_rows = await conn.fetch(
            "SELECT lat, lng FROM route_stop WHERE route_id = $1 ORDER BY seq ASC",
            route_id,
        )
        if not stop_rows:
            return None

        # Convert Database Rows into GPS Coordinates.
        points = [(r["lat"], r["lng"]) for r in stop_rows]
        return {
            "route_id": route_id,
            "points":   points,
        }