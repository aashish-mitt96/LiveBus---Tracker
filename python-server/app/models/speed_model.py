import io
import math
from dataclasses import dataclass
from typing import List, Optional

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sqlalchemy import text

from ..config import MIN_TRAINING_SAMPLES
from ..connectors.database_engine import get_engine
from ..services.shared_config import get_default_speed_mps


MIN_PAUSIBLE_SPEED_MPS = 0.5
MAX_PAUSIBLE_SPEED_MPS = 25.0

from ..config import DEFAULT_VELOCITY_VARIANCE  


# Single Training Sample Collected From a Completed Trip.
@dataclass
class TrainingSample:
    progress_fraction: float
    minute_of_day:     int
    day_of_week:       int
    speed_mps:         float


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

    # Load the Current Model for a Route from Postgres.
    @classmethod
    def load(cls, route_id: str) -> "RouteSpeedModel":
        sql = text(
            """
            SELECT estimator_blob, residual_std, sample_count
            FROM route_speed_model
            WHERE route_id = :route_id
            """
        )
        with get_engine().connect() as conn:
            row = conn.execute(sql, {"route_id": route_id}).fetchone()

        if row is None:
            return cls(route_id, None, math.sqrt(DEFAULT_VELOCITY_VARIANCE), 0)

        estimator = None
        if row.estimator_blob is not None:
            estimator = joblib.load(io.BytesIO(row.estimator_blob))

        return cls(route_id, estimator, row.residual_std, row.sample_count)

    # Predict Bus Speed for the given Route Progress & Time.
    def predict_speed(self, progress_fraction: float, minute_of_day: int, day_of_week: int) -> float:

        if not self.is_trained:
            return get_default_speed_mps()
        x = np.array([_featurize(progress_fraction, minute_of_day, day_of_week)])
        speed = float(self.estimator.predict(x)[0])
        return min(MAX_PAUSIBLE_SPEED_MPS, max(MIN_PAUSIBLE_SPEED_MPS, speed))

    # Return Measurement Variance for the Kalman Filter.
    def velocity_variance(self) -> float:
        if not self.is_trained:
            return DEFAULT_VELOCITY_VARIANCE
        return max(0.25, self.residual_std ** 2)


# Persist Newly-Submitted Samples Immediately.
def insert_training_samples(route_id: str, samples: List[TrainingSample]) -> int:
    filtered = [
        s for s in samples
        if MIN_PAUSIBLE_SPEED_MPS <= s.speed_mps <= MAX_PAUSIBLE_SPEED_MPS
    ]
    if not filtered:
        return 0

    sql = text(
        """
        INSERT INTO route_speed_training_sample
            (route_id, progress_fraction, minute_of_day, day_of_week, speed_mps)
        VALUES
            (:route_id, :progress_fraction, :minute_of_day, :day_of_week, :speed_mps)
        """
    )
    with get_engine().begin() as conn:
        conn.execute(
            sql,
            [
                {
                    "route_id":          route_id,
                    "progress_fraction": s.progress_fraction,
                    "minute_of_day":     s.minute_of_day,
                    "day_of_week":       s.day_of_week,
                    "speed_mps":         s.speed_mps,
                }
                for s in filtered
            ],
        )
    return len(filtered)


def _fetch_all_samples(route_id: str) -> List[TrainingSample]:
    sql = text(
        """
        SELECT progress_fraction, minute_of_day, day_of_week, speed_mps
        FROM route_speed_training_sample
        WHERE route_id = :route_id
        """
    )
    with get_engine().connect() as conn:
        rows = conn.execute(sql, {"route_id": route_id}).fetchall()
    return [
        TrainingSample(
            progress_fraction=r.progress_fraction,
            minute_of_day=r.minute_of_day,
            day_of_week=r.day_of_week,
            speed_mps=r.speed_mps,
        )
        for r in rows
    ]


def _save_model(model: "RouteSpeedModel", estimator_blob: Optional[bytes]) -> None:
    sql = text(
        """
        INSERT INTO route_speed_model (route_id, estimator_blob, residual_std, sample_count, updated_at)
        VALUES (:route_id, :blob, :residual_std, :sample_count, now())
        ON CONFLICT (route_id) DO UPDATE SET
            estimator_blob = EXCLUDED.estimator_blob,
            residual_std   = EXCLUDED.residual_std,
            sample_count   = EXCLUDED.sample_count,
            updated_at     = now()
        """
    )
    with get_engine().begin() as conn:
        conn.execute(
            sql,
            {
                "route_id":     model.route_id,
                "blob":         estimator_blob,
                "residual_std": model.residual_std,
                "sample_count": model.sample_count,
            },
        )


# Retrain the Model using every Sample Currently Stored for the Route.
def train_route_model(route_id: str) -> RouteSpeedModel:
    
    all_samples = _fetch_all_samples(route_id)

    if len(all_samples) < MIN_TRAINING_SAMPLES:
        model = RouteSpeedModel(route_id, None, math.sqrt(DEFAULT_VELOCITY_VARIANCE), len(all_samples))
        _save_model(model, estimator_blob=None)
        return model

    X = np.array([
        _featurize(s.progress_fraction, s.minute_of_day, s.day_of_week)
        for s in all_samples
    ])
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
    residual_std = (
        float(np.std(residuals))
        if len(residuals) > 1
        else math.sqrt(DEFAULT_VELOCITY_VARIANCE)
    )
    residual_std = max(residual_std, 0.5)

    buf = io.BytesIO()
    joblib.dump(estimator, buf)

    model = RouteSpeedModel(route_id, estimator, residual_std, len(all_samples))
    _save_model(model, estimator_blob=buf.getvalue())
    return model
