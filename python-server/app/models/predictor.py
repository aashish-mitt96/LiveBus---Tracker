import time
from typing import Optional

from .. import config
from .kalman import KalmanFilter1D
from .route_path import RoutePath
from .speed_model import HistoricalSpeedModel


class TripPredictor:
    """Maintains the Kalman-filtered state for a single bus trip."""

    # Measurement Variances used by the Kalman Filter.
    GPS_POS_VARIANCE  = 25.0     
    GPS_VEL_VARIANCE  = 1.0    
    HIST_VEL_VARIANCE = 9.0     


    # Initialize Predictor for a Trip.
    def __init__(self, trip_id: str, route_id: str, route_path: RoutePath, speed_model: HistoricalSpeedModel):

        self.trip_id     = trip_id
        self.route_id    = route_id
        self.path        = route_path
        self.speed_model = speed_model

        self.kf:               Optional[KalmanFilter1D] = None
        self.last_update_ts:   Optional[float] = None
        self.last_real_fix_ts: Optional[float] = None
        self.off_route_m:      float = 0.0


    # Process a New GPS Update.
    def ingest_gps(self, lat: float, lon: float, velocity_mps: Optional[float], ts: float):

        # Project GPS Point onto the Route.
        s, off_route     = self.path.project(lat, lon)
        self.off_route_m = off_route

        # Initialize Filter with the First GPS Fix.
        if self.kf is None:
            self.kf = KalmanFilter1D(s0=s, v0=velocity_mps or 0.0)
        else:
            # Predict State up to the Current Timestamp.
            self._advance_to(ts)
            
            pos_variance = self.GPS_POS_VARIANCE
            if off_route > config.OFF_ROUTE_ANOMALY_M:
                pos_variance *= config.OFF_ROUTE_VARIANCE_MULTIPLIER

            self.kf.update(z=s, H=[1.0, 0.0], R=pos_variance)

            # Correct Velocity if Available.
            if velocity_mps is not None:
                self.kf.update(z=velocity_mps, H=[0.0, 1.0], R=self.GPS_VEL_VARIANCE)

            # Prevent Unrealistic Speeds.
            self.kf.clamp_velocity(0.0, config.MAX_SPEED_MPS)

        self.last_update_ts = ts
        self.last_real_fix_ts = ts


    # Advance the Filter to the Given Timestamp.
    def _advance_to(self, ts: float):
        if self.kf is None:
            return

        if self.last_update_ts is None:
            self.last_update_ts = ts
            return

        dt = ts - self.last_update_ts
        if dt <= 0:
            return

        # Predict Expected Speed from Historical Data.
        v_hist = self.speed_model.predict_speed(
            self.route_id, self.kf.s, self.path.total_length, ts
        )

        # Kalman Prediction Step.
        self.kf.predict(dt)

        # Correct Velocity using the Historical Model.
        self.kf.update(z=v_hist, H=[0.0, 1.0], R=self.HIST_VEL_VARIANCE)

        # Keep Velocity within Valid Limits.
        self.kf.clamp_velocity(0.0, config.MAX_SPEED_MPS)
        self.last_update_ts = ts


    # Return the Current Estimated Bus Location.
    def predict_now(self, now_ts: Optional[float] = None) -> Optional[dict]:

        if self.kf is None:
            return None

        now_ts = now_ts if now_ts is not None else time.time()

        # Bring the Filter to the Current Time.
        self._advance_to(now_ts)

        # Convert Route Distance back to GPS Coordinates.
        lat, lon = self.path.point_at_distance(self.kf.s)
        gap = now_ts - (self.last_real_fix_ts or now_ts)

        return {
            "lat":                    lat,
            "lon":                    lon,
            "velocity":               max(self.kf.v, 0.0),
            "accuracy_radius_m":      round(self.kf.position_std, 1),
            "seconds_since_real_fix": round(gap, 1),
            "is_predicted":           gap > config.STALE_THRESHOLD_S,
        }