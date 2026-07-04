from typing import List, Optional

from pydantic import BaseModel, Field


# ---- /model/train -----------------------------------------------------
# Matches the payload Node's training.service.ts already sends — no
# change needed on the Node side for training.

class TrainSampleIn(BaseModel):
    route_id: str
    progress_fraction: float
    minute_of_day: int
    day_of_week: int
    speed_mps: float


class TrainRequest(BaseModel):
    samples: List[TrainSampleIn]


class SegmentUpdateResult(BaseModel):
    from_stop_id: str
    to_stop_id: str
    trip_avg_speed_mps: Optional[float] = None
    trip_sample_count: int


class TrainResponse(BaseModel):
    route_id: str
    trained: bool
    total_corpus_samples: int
    segments_updated: List[SegmentUpdateResult]
    message: str


# ---- /predict -----------------------------------------------------

class LastKnownLocation(BaseModel):
    lat: float
    lon: float
    timestamp: int  # epoch ms
    velocity: Optional[float] = Field(default=None, description="m/s, if known")


class PredictRequest(BaseModel):
    trip_id: str
    route_id: str
    last_known: LastKnownLocation
    now: Optional[int] = Field(default=None, description="epoch ms; defaults to server time")


class PredictResponse(BaseModel):
    trip_id: str
    lat: float
    lon: float
    velocity_mps: float
    confidence_radius_m: float
    progress_fraction: float
    predicted_at: int
    used_model: bool