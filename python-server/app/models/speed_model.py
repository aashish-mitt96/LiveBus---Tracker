from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

try:
    from sklearn.ensemble import HistGradientBoostingRegressor
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

from .. import config


# Represents a Single Historical Speed Record.
@dataclass
class SpeedSample:

    route_id:          str                
    progress_fraction: float   
    minute_of_day:     float          
    day_of_week:       int             
    speed_mps:         float              



class HistoricalSpeedModel:
    """Predicts Expected Bus Speed using Historical Trip Data."""

    # Minimum Samples required to Train an ML model.
    MIN_SAMPLES_FOR_MODEL = 200


    # Initialize storage for trained models and route averages.
    def __init__(self):
        self._models: dict[str, object] = {}
        self._route_avg: dict[str, float] = {}
        # Cached tzinfo, built once from config rather than re-parsed every tick.
        self._tz = ZoneInfo(config.TIMEZONE)


    # Train a separate model for each route.
    def fit(self, samples: list[SpeedSample]):
        by_route: dict[str, list[SpeedSample]] = {}

        # Group samples by route.
        for s in samples:
            by_route.setdefault(s.route_id, []).append(s)

        for route_id, route_samples in by_route.items():
            speeds = [s.speed_mps for s in route_samples]

            # Store average speed for fallback.
            self._route_avg[route_id] = float(np.mean(speeds))

            # Train ML model if sufficient data is available.
            if SKLEARN_AVAILABLE and len(route_samples) >= self.MIN_SAMPLES_FOR_MODEL:
                X = np.array(
                    [[s.progress_fraction, s.minute_of_day, s.day_of_week] for s in route_samples]
                )
                y = np.array(speeds)

                model = HistGradientBoostingRegressor(max_depth=4, max_iter=150)
                model.fit(X, y)

                self._models[route_id] = model


    # Predict bus speed at the given route position and time.
    def predict_speed(self, route_id: str, s: float, total_length: float, ts: float) -> float:
        if total_length <= 0:
            return config.DEFAULT_SPEED_MPS

        # Build model features.
        progress_fraction = min(1.0, max(0.0, s / total_length))
        dt = datetime.fromtimestamp(ts, tz=self._tz)
        minute_of_day = dt.hour * 60 + dt.minute
        day_of_week = dt.weekday()

        # Use trained ML model if available.
        model = self._models.get(route_id)
        if model is not None:
            X = np.array([[progress_fraction, minute_of_day, day_of_week]])
            pred = float(model.predict(X)[0])
            return float(np.clip(pred, 0.5, config.MAX_SPEED_MPS))

        # Otherwise use the route's average speed.
        avg = self._route_avg.get(route_id)
        if avg is not None:
            return float(np.clip(avg, 0.5, config.MAX_SPEED_MPS))

        # Final fallback to the global default speed.
        return config.DEFAULT_SPEED_MPS