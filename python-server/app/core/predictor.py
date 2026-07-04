import time
from typing import Tuple
from fastapi import HTTPException


from ..services.route_geometry import (
    build_route_path,
    find_segment_index,
    interpolate_at_distance,
    progress_fraction,
    project_onto_path,
)
from ..models.kalman_filter import extrapolate
from ..models.speed_model import RouteSpeedModel
from ..data.route_stops import fetch_route_stops
from ..services.segment_speed import fetch_segment_speeds
from ..utils.time_utils import minute_of_day, day_of_week
from ..schemas.schemas import PredictRequest, PredictResponse



# Predict the Current Bus Location when GPS updates Stop.
def predict(req: PredictRequest):

    stops = fetch_route_stops(req.route_id)
    if len(stops) < 2:
        raise HTTPException(404, f"Route {req.route_id} has fewer than 2 stops.")

    path = build_route_path(stops)
    if path.total_length <= 0:
        raise HTTPException(422, f"Route {req.route_id} has zero length.")

    # Load the trained model and segment speed fallbacks.
    model = RouteSpeedModel.load(req.route_id)
    segment_fallback = fetch_segment_speeds(req.route_id)

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
        from_stop = stops[seg_idx].id
        to_stop = stops[seg_idx + 1].id

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