from dataclasses import dataclass
from typing import Callable, Tuple

from ..config import KALMAN_STEP_SECONDS, PROCESS_ACCEL_VARIANCE


# Kalman filter State (position, velocity & covariance matrix).
@dataclass
class KalmanState:
    s:    float
    v:    float
    p_ss: float
    p_sv: float
    p_vv: float



# Initialize the Filter with Starting Position & Velocity.
def _init_state(s0: float, v0: float, position_variance: float, velocity_variance: float) -> KalmanState:
    return KalmanState(s=s0, v=v0, p_ss=position_variance, p_sv=0.0, p_vv=velocity_variance)



# Predict the Next State Assuming Constant Velocity.
def _predict(state: KalmanState, dt: float) -> KalmanState:

    # State Transition.
    s = state.s + state.v * dt
    v = state.v

    # Covariance Prediction.
    p_ss = state.p_ss + 2 * dt * state.p_sv + dt * dt * state.p_vv
    p_sv = state.p_sv + dt * state.p_vv
    p_vv = state.p_vv

    # Add Process Noise due to Unknown Acceleration.
    q = PROCESS_ACCEL_VARIANCE * dt
    p_ss += q * (dt ** 3) / 3
    p_sv += q * (dt ** 2) / 2
    p_vv += q * dt

    return KalmanState(s=s, v=v, p_ss=p_ss, p_sv=p_sv, p_vv=p_vv)



# Correct the Predicted Velocity using the Speed Model.
def _update_with_velocity_measurement(state: KalmanState, v_measured: float, r: float) -> KalmanState:

    innovation = v_measured - state.v
    innovation_cov = state.p_vv + r
    if innovation_cov <= 0:
        return state

    # Kalman Gain.
    k_s = state.p_sv / innovation_cov
    k_v = state.p_vv / innovation_cov

    # State Update.
    s = state.s + k_s * innovation
    v = state.v + k_v * innovation

    # Covariance Update.
    p_ss = state.p_ss - k_s * state.p_sv
    p_sv = state.p_sv - k_v * state.p_sv
    p_vv = state.p_vv - k_v * state.p_vv

    return KalmanState(s=s, v=v, p_ss=max(p_ss, 0.0), p_sv=p_sv, p_vv=max(p_vv, 0.0))



# Predict the Bus Position over the Given Elapsed Time.
def extrapolate(
    s0:                 float,
    v0:                 float,
    elapsed_seconds:    float,
    speed_at:           Callable[[float], Tuple[float, float]],
    total_length:       float,
    position_variance0: float = 25.0,
    velocity_variance0: float = 4.0,
) -> KalmanState:

    state = _init_state(s0, v0, position_variance0, velocity_variance0)
    remaining = elapsed_seconds

    while remaining > 1e-6:

        dt = min(KALMAN_STEP_SECONDS, remaining)
        state = _predict(state, dt)
        state.s = max(0.0, min(total_length, state.s))

        # Correct Using the Predicted Route Speed.
        v_model, r = speed_at(state.s)
        state = _update_with_velocity_measurement(state, v_model, r)
        state.s = max(0.0, min(total_length, state.s))

        remaining -= dt
    return state