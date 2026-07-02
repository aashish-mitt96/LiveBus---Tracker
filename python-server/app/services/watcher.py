import asyncio
import json
import logging
import time
from typing import Optional

from .. import config
from ..state.registry import registry
from ..models.route_path import RoutePath
from ..models.predictor import TripPredictor
from ..data.route import get_trip_route_and_stops
from ..models.speed_model import HistoricalSpeedModel
from ..connectors.redis import get_client
from ..data.location import publish_processed_location

logger = logging.getLogger("Dead_Zone_Prediction_Service")

# Shared Historical Speed Model used across all Trips.
speed_model = HistoricalSpeedModel()



# Create & Register a Predictor for a trip if it doesn't already exist.
async def _ensure_predictor(trip_id: str) -> Optional[TripPredictor]:

    existing = await registry.get(trip_id)
    if existing:
        return existing

    # Load route and stop information from the database.
    info = await get_trip_route_and_stops(trip_id)
    if not info or len(info["points"]) < 2:
        logger.warning(f"[predictor] no route/stops found for trip {trip_id}, skipping")
        return None

    # Build the route path and initialize the predictor.
    path = RoutePath(info["points"])
    predictor = TripPredictor(trip_id, info["route_id"], path, speed_model)

    # Store predictor for future GPS updates.
    await registry.set(trip_id, predictor)
    return predictor



# Listen for Real GPS Ppdates from Redis.
async def consume_real_fixes():
    client = get_client()
    pubsub = client.pubsub()
    await pubsub.subscribe("processed_data")

    async for message in pubsub.listen():
        # Ignore non-message events.
        if message["type"] != "message":
            continue

        try:
            data = json.loads(message["data"])
            trip_id = data.get("tripId")
            if not trip_id:
                continue

            # Ignore predicted locations published by this service.
            if data.get("predicted"):
                continue

            # Get or create the trip predictor.
            predictor = await _ensure_predictor(trip_id)
            if predictor is None:
                continue

            # Convert timestamp to seconds if needed.
            raw_ts = data.get("timestamp", time.time() * 1000)
            ts = raw_ts / 1000.0 if raw_ts > 1_000_000_000_000 else raw_ts

            # Feed the real GPS fix into the predictor.
            predictor.ingest_gps(
                lat=data["lat"],
                lon=data["lon"],
                velocity_mps=data.get("velocity"),
                ts=ts,
            )
        except Exception as err:
            logger.error(f"[predictor] failed to process real fix: {err}")



# Periodically Publish Predicted Locations for Inactive Trips.
async def publish_predictions_for_stale_trips():
    while True:
        try:
            now = time.time()

            # Check every active trip.
            for trip_id in await registry.all_trip_ids():
                predictor = await registry.get(trip_id)
                if predictor is None:
                    continue

                # Time since the last real GPS update.
                gap = now - (predictor.last_real_fix_ts or now)

                # Remove trips that have been inactive for too long.
                if gap > config.TRIP_IDLE_EXPIRE_S:
                    await registry.remove(trip_id)
                    continue

                # Skip trips still receiving live updates.
                if gap <= config.STALE_THRESHOLD_S:
                    continue

                # Generate the next predicted location.
                result = predictor.predict_now(now)
                if result is None:
                    continue

                # Publish the predicted location to Redis.
                await publish_processed_location({
                    "tripId": trip_id,
                    "lat": result["lat"],
                    "lon": result["lon"],
                    "velocity": result["velocity"],
                    "timestamp": int(now * 1000),
                    "map_matched": False,
                    "predicted": True,
                    "accuracy_radius_m": result["accuracy_radius_m"],
                    "seconds_since_real_fix": result["seconds_since_real_fix"],
                })
        except Exception as err:
            logger.error(f"[predictor] stale-trip publish loop error: {err}")

        # Wait before the next prediction cycle.
        await asyncio.sleep(config.PREDICT_TICK_S)