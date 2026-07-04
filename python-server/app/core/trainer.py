from typing import Dict, List
from fastapi import HTTPException
from collections import defaultdict

from ..data.route_stops import fetch_route_stops
from ..services.segment_speed import upsert_segment_speed
from ..models.speed_model import TrainingSample, train_route_model
from ..schemas.schemas import SegmentUpdateResult, TrainRequest, TrainResponse
from ..services.route_geometry import build_route_path, find_segment_index



# Train the Speed model for a Route using Completed Trip Samples.
def model_train(req: TrainRequest):

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

    # Train or Update the Route Model.
    model = train_route_model(route_id, training_samples)

    # Update Average Speed for each Route Segment.
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

    # Return Training Summary.
    return TrainResponse(
        route_id             = route_id,
        trained              = model.is_trained,
        total_corpus_samples = model.sample_count,
        segments_updated     = segment_results,
        message=(
            f"Model trained on {model.sample_count} accumulated samples."
            if model.is_trained
            else f"Only {model.sample_count} samples so far — need more before the model is trusted over defaults."
        ),
    )