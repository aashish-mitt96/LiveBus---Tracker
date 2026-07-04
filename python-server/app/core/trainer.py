from collections import defaultdict
from typing import Dict, List

from fastapi import BackgroundTasks, HTTPException

from ..connectors.database_engine import get_engine
from ..data.route_stops import fetch_route_stops
from ..models.speed_model import RouteSpeedModel, TrainingSample, insert_training_samples, train_route_model
from ..schemas.schemas import ModelStatusResponse, SegmentUpdateResult, TrainRequest, TrainResponse
from ..services import route_cache
from ..services.route_geometry import build_route_path, find_segment_index
from ..services.segment_speed import upsert_segment_speed
from ..services.training_lock import try_route_training_lock
from ..utils.validation import validate_route_id


# Runs After the /model/train Response has Already Been Sent.
def _retrain_in_background(route_id: str) -> None:
    with get_engine().connect() as conn:
        with try_route_training_lock(conn, route_id) as acquired:
            if not acquired:
                return
            train_route_model(route_id)

    route_cache.invalidate(f"model:{route_id}")


# Accept Training Samples for a Route and Queue a Retrain.
def model_train(req: TrainRequest, background_tasks: BackgroundTasks) -> TrainResponse:

    if not req.samples:
        raise HTTPException(400, "No samples provided.")

    # Group Samples by Route.
    by_route: Dict[str, List] = defaultdict(list)
    for s in req.samples:
        by_route[s.route_id].append(s)

    # Each Request should Contain Samples for only one Route.
    if len(by_route) != 1:
        raise HTTPException(
            400,
            "All samples in one /model/train call must share the same route_id.",
        )
    route_id, samples = next(iter(by_route.items()))
    validate_route_id(route_id)

    # Load Route Geometry.
    stops = fetch_route_stops(route_id)
    if len(stops) < 2:
        raise HTTPException(
            404,
            f"Route {route_id} has fewer than 2 stops — nothing to train on.",
        )
    path = build_route_path(stops)
    if path.total_length <= 0:
        raise HTTPException(422, f"Route {route_id} has zero length.")

    # Prepare Training Samples & Collect Speeds for each Route Segment.
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
        seg_idx  = find_segment_index(path, sample_s)
        segment_speeds[seg_idx].append(s.speed_mps)

    # Persist the raw samples right away (fast, plain inserts).
    accepted = insert_training_samples(route_id, training_samples)

    # Update Average Speed for each Route Segment (atomic upsert — safe
    segment_results: List[SegmentUpdateResult] = []
    for seg_idx, speeds in segment_speeds.items():
        from_stop = stops[seg_idx]
        to_stop   = stops[seg_idx + 1]

        trip_avg = sum(speeds) / len(speeds)
        upsert_segment_speed(
            route_id,
            from_stop.id,
            to_stop.id,
            trip_avg,
            len(speeds),
        )
        segment_results.append(
            SegmentUpdateResult(
                from_stop_id       = from_stop.id,
                to_stop_id         = to_stop.id,
                trip_avg_speed_mps = round(trip_avg, 3),
                trip_sample_count  = len(speeds),
            )
        )

    # Queue the slow part for after the response is sent.
    background_tasks.add_task(_retrain_in_background, route_id)

    return TrainResponse(
        route_id         = route_id,
        accepted_samples = accepted,
        segments_updated = segment_results,
        retrain_queued   = True,
        message          = f"{accepted} samples stored; retraining queued in the background.",
    )


# Report the Model's Current Trained Status for a Route.
def model_status(route_id: str) -> ModelStatusResponse:
    validate_route_id(route_id)
    model = RouteSpeedModel.load(route_id)
    return ModelStatusResponse(
        route_id=route_id,
        trained=model.is_trained,
        sample_count=model.sample_count,
    )
