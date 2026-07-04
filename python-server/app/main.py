import time
from collections import defaultdict
from typing import Dict, List, Tuple

from fastapi import FastAPI, HTTPException

from .database import db
from .services.geo import build_route_path, find_segment_index, interpolate_at_distance, progress_fraction, project_onto_path
from .models.kalman import extrapolate
from .schemas.schemas import (
    PredictRequest,
    PredictResponse,
    SegmentUpdateResult,
    TrainRequest,
    TrainResponse,
)
from .models.speed_model import RouteSpeedModel, TrainingSample, train_route_model

app = FastAPI(title="Bus Route Predictor", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


# -------------------------------------------------------------------------
# Training — called by Node's endTrip -> sendTrainingSamples, unchanged.
# -------------------------------------------------------------------------
@app.post("/model/train", response_model=TrainResponse)
def model_train(req: TrainRequest):
    if not req.samples:
        raise HTTPException(400, "No samples provided.")

    by_route: Dict[str, List] = defaultdict(list)
    for s in req.samples:
        by_route[s.route_id].append(s)

    if len(by_route) != 1:
        # Node always sends samples for a single trip/route per call; guard
        # against surprises rather than silently mixing routes together.
        raise HTTPException(400, "All samples in one /model/train call must share the same route_id.")

    route_id, samples = next(iter(by_route.items()))

    stops = db.fetch_route_stops(route_id)
    if len(stops) < 2:
        raise HTTPException(404, f"Route {route_id} has fewer than 2 stops — nothing to train on.")

    path = build_route_path(stops)
    if path.total_length <= 0:
        raise HTTPException(422, f"Route {route_id} has zero length.")

    # Bucket this trip's samples into (from_stop, to_stop) segments using
    # each sample's progress_fraction, so we can update route_segment_speed
    # alongside training the continuous model.
    segment_speeds: Dict[int, List[float]] = defaultdict(list)
    training_samples: List[TrainingSample] = []

    for s in samples:
        training_samples.append(
            TrainingSample(
                progress_fraction=s.progress_fraction,
                minute_of_day=s.minute_of_day,
                day_of_week=s.day_of_week,
                speed_mps=s.speed_mps,
            )
        )
        sample_s = s.progress_fraction * path.total_length
        seg_idx = find_segment_index(path, sample_s)
        segment_speeds[seg_idx].append(s.speed_mps)

    model = train_route_model(route_id, training_samples)

    segment_results: List[SegmentUpdateResult] = []
    for seg_idx, speeds in segment_speeds.items():
        from_stop = stops[seg_idx]
        to_stop = stops[seg_idx + 1]
        trip_avg = sum(speeds) / len(speeds)
        db.upsert_segment_speed(route_id, from_stop.id, to_stop.id, trip_avg, len(speeds))
        segment_results.append(
            SegmentUpdateResult(
                from_stop_id=from_stop.id,
                to_stop_id=to_stop.id,
                trip_avg_speed_mps=round(trip_avg, 3),
                trip_sample_count=len(speeds),
            )
        )

    return TrainResponse(
        route_id=route_id,
        trained=model.is_trained,
        total_corpus_samples=model.sample_count,
        segments_updated=segment_results,
        message=(
            f"Model trained on {model.sample_count} accumulated samples."
            if model.is_trained
            else f"Only {model.sample_count} samples so far — need more before the model is trusted over defaults."
        ),
    )


# -------------------------------------------------------------------------
# Prediction — called by Node when a trip's GPS pings go silent.
# -------------------------------------------------------------------------
@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    stops = db.fetch_route_stops(req.route_id)
    if len(stops) < 2:
        raise HTTPException(404, f"Route {req.route_id} has fewer than 2 stops.")

    path = build_route_path(stops)
    if path.total_length <= 0:
        raise HTTPException(422, f"Route {req.route_id} has zero length.")

    model = RouteSpeedModel.load(req.route_id)
    segment_fallback = db.fetch_segment_speeds(req.route_id)

    s0 = project_onto_path(req.last_known.lat, req.last_known.lon, path)
    v0 = req.last_known.velocity if req.last_known.velocity is not None else model.predict_speed(
        progress_fraction(path, s0), _minute_of_day(req.last_known.timestamp), _day_of_week(req.last_known.timestamp)
    )

    now_ms = req.now if req.now is not None else int(time.time() * 1000)
    elapsed_s = max(0.0, (now_ms - req.last_known.timestamp) / 1000.0)

    def speed_at(current_s: float) -> Tuple[float, float]:
        minute = _minute_of_day(now_ms)
        day = _day_of_week(now_ms)
        if model.is_trained:
            return model.predict_speed(progress_fraction(path, current_s), minute, day), model.velocity_variance()

        # No trained model yet: fall back to this segment's observed
        # running-average speed if we have one, else the global default.
        seg_idx = find_segment_index(path, current_s)
        from_stop, to_stop = stops[seg_idx].id, stops[seg_idx + 1].id
        fallback_speed = segment_fallback.get((from_stop, to_stop), model.predict_speed(0, minute, day))
        return fallback_speed, model.velocity_variance()

    final_state = extrapolate(
        s0=s0,
        v0=v0,
        elapsed_seconds=elapsed_s,
        speed_at=speed_at,
        total_length=path.total_length,
    )

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


def _minute_of_day(epoch_ms: int) -> int:
    import datetime
    import zoneinfo

    from .config import TIMEZONE

    dt = datetime.datetime.fromtimestamp(epoch_ms / 1000, tz=zoneinfo.ZoneInfo(TIMEZONE))
    return dt.hour * 60 + dt.minute


def _day_of_week(epoch_ms: int) -> int:
    import datetime
    import zoneinfo

    from .config import TIMEZONE

    dt = datetime.datetime.fromtimestamp(epoch_ms / 1000, tz=zoneinfo.ZoneInfo(TIMEZONE))
    # Monday=0 ... Sunday=6, matching Node's weekdayMap in training.service.ts
    return dt.weekday()