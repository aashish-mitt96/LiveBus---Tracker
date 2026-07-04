import time
from typing import Tuple
from fastapi import HTTPException

from ..config import MODEL_CACHE_TTL_SECONDS, ROUTE_CACHE_TTL_SECONDS
from ..services.route_geometry import (
    RoutePath,
    build_route_path,
    find_segment_index,
    interpolate_at_distance,
    progress_fraction,
    project_onto_path,
)
from ..models.kalman_filter import extrapolate
from ..models.speed_model import RouteSpeedModel
from ..data.route_stops import fetch_route_stops, fetch_trip_route_id
from ..services.segment_speed import fetch_segment_speeds
from ..services import route_cache
from ..utils.time_utils import minute_of_day, day_of_week
from ..utils.validation import validate_route_id
from ..schemas.schemas import PredictRequest, PredictResponse



# Load Route Geometry, Reusing a Cached Copy when Available.
def _load_path_cached(route_id: str) -> RoutePath:
    key = f"path:{route_id}"
    cached = route_cache.get(key)
    if cached is not None:
        return cached

    stops = fetch_route_stops(route_id)
    if len(stops) < 2:
        raise HTTPException(404, f"Route {route_id} has fewer than 2 stops.")
    path = build_route_path(stops)
    if path.total_length <= 0:
        raise HTTPException(422, f"Route {route_id} has zero length.")

    route_cache.set(key, path, ttl_seconds=ROUTE_CACHE_TTL_SECONDS)
    return path


# Load the Speed Model, Reusing a Cached Copy when Available.
def _load_model_cached(route_id: str) -> RouteSpeedModel:
    key = f"model:{route_id}"
    cached = route_cache.get(key)
    if cached is not None:
        return cached

    model = RouteSpeedModel.load(route_id)
    route_cache.set(key, model, ttl_seconds=MODEL_CACHE_TTL_SECONDS)
    return model


# Predict the Current Bus Location when GPS updates Stop.
def predict(req: PredictRequest) -> PredictResponse:

    validate_route_id(req.route_id)
    canonical_route_id = fetch_trip_route_id(req.trip_id)
    if canonical_route_id is None:
        raise HTTPException(404, f"Trip {req.trip_id} not found.")
    if canonical_route_id != req.route_id:
        raise HTTPException(
            400,
            f"Trip {req.trip_id} belongs to route {canonical_route_id}, not {req.route_id}.",
        )
    route_id = canonical_route_id

    path = _load_path_cached(route_id)
    model = _load_model_cached(route_id)
    segment_fallback = fetch_segment_speeds(route_id)

    # Convert the last GPS fix into distance along the route.
    s0 = project_onto_path(req.last_known.lat, req.last_known.lon, path)

    # Use the last measured speed, or estimate one from the model.
    v0 = (
        req.last_known.velocity
        if req.last_known.velocity is not None
        else model.predict_speed(
            progress_fraction(path, s0),
            minute_of_day(req.last_known.timestamp),
            day_of_week(req.last_known.timestamp),
        )
    )
    now_ms = req.now if req.now is not None else int(time.time() * 1000)
    elapsed_s = max(0.0, (now_ms - req.last_known.timestamp) / 1000.0)

    # Returns the expected speed at a given route position.
    def speed_at(current_s: float) -> Tuple[float, float]:
        minute = minute_of_day(now_ms)
        day = day_of_week(now_ms)

        if model.is_trained:
            return (
                model.predict_speed(
                    progress_fraction(path, current_s),
                    minute,
                    day,
                ),
                model.velocity_variance(),
            )

        # Fall back to historical segment speed if the model isn't trained.
        seg_idx = find_segment_index(path, current_s)
        from_stop = path.stops[seg_idx].id
        to_stop = path.stops[seg_idx + 1].id

        fallback_speed = segment_fallback.get(
            (from_stop, to_stop),
            model.predict_speed(0, minute, day),
        )
        return fallback_speed, model.velocity_variance()

    # Run the Kalman filter to estimate the current state.
    final_state = extrapolate(
        s0=s0,
        v0=v0,
        elapsed_seconds=elapsed_s,
        speed_at=speed_at,
        total_length=path.total_length,
    )

    # Convert the predicted route distance back to GPS coordinates.
    lat, lon = interpolate_at_distance(path, final_state.s)
    confidence_radius_m = max(5.0, final_state.p_ss ** 0.5)

    return PredictResponse(
        trip_id=req.trip_id,
        lat=lat,
        lon=lon,
        velocity_mps=round(final_state.v, 3),
        confidence_radius_m=round(confidence_radius_m, 1),
        progress_fraction=round(progress_fraction(path, final_state.s), 4),
        predicted_at=now_ms,
        used_model=model.is_trained,
    )
