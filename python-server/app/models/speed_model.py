"""
One speed model per route. Predicts expected bus speed (m/s) given where on
the route it is (progress fraction) and when (time of day / day of week).

Why this shape, and why it's retrained-from-corpus rather than online:
raw GPS points only live 2h in Redis (trip:{id}:locs), so by the time a
trip ends and training samples are forwarded here, the only place a
lasting training set can live is with us. Each /model/train call appends
this trip's samples to a small per-route JSONL corpus, then refits on the
whole corpus. At the sample volumes a bus route produces (dozens of points
per trip) this is cheap even after months of trips — no need for real
online/incremental learning to get the "improves as more data arrives"
behavior that was asked for.

Time-of-day is cyclic (23:59 is close to 00:00), so minute_of_day is
sin/cos encoded rather than passed in as a raw linear feature — a real,
if modest, accuracy improvement over a naive model, which is about as
far as "fantastic ML model" can honestly go without overselling it.
"""
import json
import math
import os
from dataclasses import dataclass
from typing import List, Optional

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

from ..config import DEFAULT_SPEED_MPS, DEFAULT_VELOCITY_VARIANCE, MIN_TRAINING_SAMPLES, MODEL_DIR

MIN_PLAUSIBLE_SPEED_MPS = 0.5
MAX_PLAUSIBLE_SPEED_MPS = 25.0


@dataclass
class TrainingSample:
    progress_fraction: float
    minute_of_day: int
    day_of_week: int
    speed_mps: float


def _model_path(route_id: str) -> str:
    return os.path.join(MODEL_DIR, f"{route_id}.joblib")


def _corpus_path(route_id: str) -> str:
    return os.path.join(MODEL_DIR, f"{route_id}.corpus.jsonl")


def _featurize(progress_fraction: float, minute_of_day: int, day_of_week: int) -> List[float]:
    angle = 2 * math.pi * (minute_of_day / 1440.0)
    return [progress_fraction, math.sin(angle), math.cos(angle), day_of_week]


class RouteSpeedModel:
    """Loaded (or empty) wrapper around a route's persisted HistGradientBoostingRegressor."""

    def __init__(self, route_id: str, estimator: Optional[HistGradientBoostingRegressor], residual_std: float, sample_count: int):
        self.route_id = route_id
        self.estimator = estimator
        self.residual_std = residual_std
        self.sample_count = sample_count

    @property
    def is_trained(self) -> bool:
        return self.estimator is not None and self.sample_count >= MIN_TRAINING_SAMPLES

    @classmethod
    def load(cls, route_id: str) -> "RouteSpeedModel":
        path = _model_path(route_id)
        if os.path.exists(path):
            payload = joblib.load(path)
            return cls(route_id, payload["estimator"], payload["residual_std"], payload["sample_count"])
        return cls(route_id, None, math.sqrt(DEFAULT_VELOCITY_VARIANCE), 0)

    def predict_speed(self, progress_fraction: float, minute_of_day: int, day_of_week: int) -> float:
        if not self.is_trained:
            return DEFAULT_SPEED_MPS
        x = np.array([_featurize(progress_fraction, minute_of_day, day_of_week)])
        speed = float(self.estimator.predict(x)[0])
        return min(MAX_PLAUSIBLE_SPEED_MPS, max(MIN_PLAUSIBLE_SPEED_MPS, speed))

    def velocity_variance(self) -> float:
        """Measurement noise fed into the Kalman filter for this model's
        predicted-speed 'measurement'. Falls back to a fixed default until
        there's enough data for the model's own residual spread to be
        trustworthy."""
        if not self.is_trained:
            return DEFAULT_VELOCITY_VARIANCE
        return max(0.25, self.residual_std ** 2)


def _append_corpus(route_id: str, samples: List[TrainingSample]) -> List[TrainingSample]:
    path = _corpus_path(route_id)
    with open(path, "a") as f:
        for s in samples:
            f.write(json.dumps(s.__dict__) + "\n")

    all_samples: List[TrainingSample] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            all_samples.append(TrainingSample(**d))
    return all_samples


def train_route_model(route_id: str, samples: List[TrainingSample]) -> RouteSpeedModel:
    """Append this trip's samples to the route's corpus and refit."""
    filtered = [
        s for s in samples
        if MIN_PLAUSIBLE_SPEED_MPS <= s.speed_mps <= MAX_PLAUSIBLE_SPEED_MPS
    ]
    all_samples = _append_corpus(route_id, filtered)

    if len(all_samples) < MIN_TRAINING_SAMPLES:
        # Not enough data yet to fit anything meaningful — persist nothing,
        # callers fall back to DEFAULT_SPEED_MPS / route_segment_speed.
        return RouteSpeedModel(route_id, None, math.sqrt(DEFAULT_VELOCITY_VARIANCE), len(all_samples))

    X = np.array([_featurize(s.progress_fraction, s.minute_of_day, s.day_of_week) for s in all_samples])
    y = np.array([s.speed_mps for s in all_samples])

    estimator = HistGradientBoostingRegressor(
        max_depth=4,
        max_iter=150,
        learning_rate=0.08,
        l2_regularization=0.5,
        random_state=42,
    )
    estimator.fit(X, y)

    residuals = y - estimator.predict(X)
    residual_std = float(np.std(residuals)) if len(residuals) > 1 else math.sqrt(DEFAULT_VELOCITY_VARIANCE)
    residual_std = max(residual_std, 0.5)  # never claim to be more confident than this

    joblib.dump(
        {"estimator": estimator, "residual_std": residual_std, "sample_count": len(all_samples)},
        _model_path(route_id),
    )
    return RouteSpeedModel(route_id, estimator, residual_std, len(all_samples))