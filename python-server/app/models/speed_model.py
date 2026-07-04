import json
import math
import os
import joblib
import numpy as np
from dataclasses import dataclass
from typing import List, Optional
from sklearn.ensemble import HistGradientBoostingRegressor

from ..config import DEFAULT_SPEED_MPS, DEFAULT_VELOCITY_VARIANCE, MIN_TRAINING_SAMPLES, MODEL_DIR


MIN_PAUSIBLE_SPEED_MPS = 0.5
MAX_PAUSIBLE_SPEED_MPS = 25.0


# Single Training Sample Collected From a Completed Trip.
@dataclass
class TrainingSample:
    progress_fraction: float
    minute_of_day:     int
    day_of_week:       int
    speed_mps:         float



# Path where the Trained Model is Stored.
def _model_path(route_id: str) -> str:
    return os.path.join(MODEL_DIR, f"{route_id}.joblib")



# Path where Raw Training Samples are Stored.
def _corpus_path(route_id: str) -> str:
    return os.path.join(MODEL_DIR, f"{route_id}.corpus.jsonl")



# Convert Raw Inputs into ML Features.
def _featurize(progress_fraction: float, minute_of_day: int, day_of_week: int) -> List[float]:
    angle = 2 * math.pi * (minute_of_day / 1440.0)
    return [progress_fraction, math.sin(angle), math.cos(angle), day_of_week]



# Route's Trained Speed Prediction Model.
class RouteSpeedModel:
    def __init__(self, route_id: str, estimator: Optional[HistGradientBoostingRegressor], residual_std: float, sample_count: int):

        self.route_id     = route_id
        self.estimator    = estimator
        self.residual_std = residual_std
        self.sample_count = sample_count


    @property
    def is_trained(self) -> bool:
        return self.estimator is not None and self.sample_count >= MIN_TRAINING_SAMPLES


    # Load a Saved Model if Available.
    @classmethod
    def load(cls, route_id: str) -> "RouteSpeedModel":

        path = _model_path(route_id)
        if os.path.exists(path):
            payload = joblib.load(path)
            return cls(route_id, payload["estimator"], payload["residual_std"], payload["sample_count"])
        return cls(route_id, None, math.sqrt(DEFAULT_VELOCITY_VARIANCE), 0)


    # Predict Bus Speed for the given Route Progress & Time.
    def predict_speed(self, progress_fraction: float, minute_of_day: int, day_of_week: int) -> float:

        if not self.is_trained:
            return DEFAULT_SPEED_MPS
        x = np.array([_featurize(progress_fraction, minute_of_day, day_of_week)])
        speed = float(self.estimator.predict(x)[0])
        return min(MAX_PAUSIBLE_SPEED_MPS, max(MIN_PAUSIBLE_SPEED_MPS, speed))


    # Return Measurement Variance for the Kalman Filter.
    def velocity_variance(self) -> float:
        if not self.is_trained:
            return DEFAULT_VELOCITY_VARIANCE
        return max(0.25, self.residual_std ** 2)
    


# Append New Trip Samples & Reload the Complete Corpus.
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



# Retrain the Model using all Collected Samples for the Route.
def train_route_model(route_id: str, samples: List[TrainingSample]) -> RouteSpeedModel:

    filtered = [
        s for s in samples
        if MIN_PAUSIBLE_SPEED_MPS <= s.speed_mps <= MAX_PAUSIBLE_SPEED_MPS
    ]

    all_samples = _append_corpus(route_id, filtered)

    if len(all_samples) < MIN_TRAINING_SAMPLES:
        return RouteSpeedModel(route_id, None, math.sqrt(DEFAULT_VELOCITY_VARIANCE), len(all_samples))

    # Build Training Dataset.
    X = np.array([
        _featurize(s.progress_fraction, s.minute_of_day, s.day_of_week)
        for s in all_samples
    ])
    y = np.array([s.speed_mps for s in all_samples])

    # Train the Regression Model.
    estimator = HistGradientBoostingRegressor(
        max_depth=4,
        max_iter=150,
        learning_rate=0.08,
        l2_regularization=0.5,
        random_state=42,
    )
    estimator.fit(X, y)

    # Estimate Prediction Error from Training Residuals.
    residuals = y - estimator.predict(X)
    residual_std = (
        float(np.std(residuals))
        if len(residuals) > 1
        else math.sqrt(DEFAULT_VELOCITY_VARIANCE)
    )
    residual_std = max(residual_std, 0.5)

    # Save the Trained Model.
    joblib.dump(
        {
            "estimator":    estimator,
            "residual_std": residual_std,
            "sample_count": len(all_samples),
        },
        _model_path(route_id),
    )

    return RouteSpeedModel(route_id, estimator, residual_std, len(all_samples))