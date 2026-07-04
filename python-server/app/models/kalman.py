"""
Dead-zone position extrapolator.

State: x = [s, v]  where s = distance travelled along the route polyline
(meters), v = speed (m/s). There is no GPS during a dead zone, so there's
no position measurement — instead, at every small time-step we treat the
ML speed model's predicted speed as a *velocity* measurement and run a
standard predict/update Kalman cycle:

  predict:  s  += v * dt
            P   = F P F^T + Q                (uncertainty grows with dt)

  update:   innovation = v_model - v
            v          += K * innovation      (pulled toward model's speed)
            P           = (I - K H) P

This is exactly "Kalman filter takes speed from the model, checks distance
along the route" — the model supplies velocity, the filter integrates it
into position and keeps a principled, growing uncertainty estimate the
whole time GPS is unavailable. Once real GPS resumes, Node's existing
pipeline (LocationIQ map-matching) takes back over; nothing here persists
across the gap.
"""
from dataclasses import dataclass
from typing import Callable, List, Tuple

from ..config import KALMAN_STEP_SECONDS, PROCESS_ACCEL_VARIANCE

@dataclass
class KalmanState:
    s: float           # meters along route
    v: float            # m/s
    p_ss: float
    p_sv: float
    p_vv: float


def _init_state(s0: float, v0: float, position_variance: float, velocity_variance: float) -> KalmanState:
    return KalmanState(s=s0, v=v0, p_ss=position_variance, p_sv=0.0, p_vv=velocity_variance)


def _predict(state: KalmanState, dt: float) -> KalmanState:
    # F = [[1, dt], [0, 1]]
    s = state.s + state.v * dt
    v = state.v

    p_ss = state.p_ss + 2 * dt * state.p_sv + dt * dt * state.p_vv
    p_sv = state.p_sv + dt * state.p_vv
    p_vv = state.p_vv

    # Process noise: uncertainty injected by not knowing the bus's
    # acceleration over this step (classic constant-velocity model noise).
    q = PROCESS_ACCEL_VARIANCE * dt
    p_ss += q * (dt ** 3) / 3
    p_sv += q * (dt ** 2) / 2
    p_vv += q * dt

    return KalmanState(s=s, v=v, p_ss=p_ss, p_sv=p_sv, p_vv=p_vv)


def _update_with_velocity_measurement(state: KalmanState, v_measured: float, r: float) -> KalmanState:
    # H = [0, 1] — we only "measure" velocity.
    innovation = v_measured - state.v
    innovation_cov = state.p_vv + r
    if innovation_cov <= 0:
        return state

    k_s = state.p_sv / innovation_cov
    k_v = state.p_vv / innovation_cov

    s = state.s + k_s * innovation
    v = state.v + k_v * innovation

    p_ss = state.p_ss - k_s * state.p_sv
    p_sv = state.p_sv - k_v * state.p_sv
    p_vv = state.p_vv - k_v * state.p_vv

    return KalmanState(s=s, v=v, p_ss=max(p_ss, 0.0), p_sv=p_sv, p_vv=max(p_vv, 0.0))


def extrapolate(
    s0: float,
    v0: float,
    elapsed_seconds: float,
    speed_at: Callable[[float], Tuple[float, float]],
    total_length: float,
    position_variance0: float = 25.0,
    velocity_variance0: float = 4.0,
) -> KalmanState:
    """
    Steps forward from (s0, v0) for `elapsed_seconds`, calling
    speed_at(current_s) -> (predicted_speed_mps, measurement_variance) at
    each step to pull the filter's velocity toward the model's prediction.
    Clamps s to [0, total_length] (can't overshoot the route).
    """
    state = _init_state(s0, v0, position_variance0, velocity_variance0)
    remaining = elapsed_seconds

    while remaining > 1e-6:
        dt = min(KALMAN_STEP_SECONDS, remaining)
        state = _predict(state, dt)
        state.s = max(0.0, min(total_length, state.s))

        v_model, r = speed_at(state.s)
        state = _update_with_velocity_measurement(state, v_model, r)
        state.s = max(0.0, min(total_length, state.s))

        remaining -= dt

    return state