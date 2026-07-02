import numpy as np


class KalmanFilter1D:
    """1D Constant Velocity Kalman Filter.

    Tracks:
    -> s : Distance travelled along the route (meters)
    -> v : Bus velocity (m/s)

    GPS updates correct the position, while the historical speed model
    continuously estimates the velocity when GPS is unavailable.
    """

    # Initialize Filter State and Uncertainty.
    def __init__(self, s0: float, v0: float, p_pos: float = 25.0, p_vel: float = 9.0):

        self.x = np.array([[float(s0)], [float(v0)]])  
        self.P = np.diag([float(p_pos), float(p_vel)]) 


    # Predict the Next State after dt Seconds.
    def predict(self, dt: float, process_noise_pos: float = 0.5, process_noise_vel: float = 0.6):

        F = np.array([[1.0, dt], [0.0, 1.0]])  
        Q = np.array([[process_noise_pos * dt ** 2, 0.0],
                      [0.0, process_noise_vel * dt]])  

        self.x = F @ self.x
        self.P = F @ self.P @ F.T + Q


    # Update the Filter using a New Measurement.
    def update(self, z: float, H: list[float], R: float):

        H_mat = np.array(H).reshape(1, 2)      
        z_mat = np.array([[float(z)]])        
        R_mat = np.array([[float(R)]])       

        y = z_mat - H_mat @ self.x             
        S = H_mat @ self.P @ H_mat.T + R_mat   
        K = self.P @ H_mat.T @ np.linalg.inv(S)

        self.x = self.x + K @ y             
        self.P = (np.eye(2) - K @ H_mat) @ self.P  


    # Keep Velocity within Realistic Limits.
    def clamp_velocity(self, min_v: float, max_v: float):
        self.x[1, 0] = max(min_v, min(self.x[1, 0], max_v))


    # Current Estimated Distance along the Route.
    @property
    def s(self) -> float:
        return float(self.x[0, 0])
    

    # Current Estimated Velocity.
    @property
    def v(self) -> float:
        return float(self.x[1, 0])


    # Position Uncertainty (meters).
    @property
    def position_std(self) -> float:
        return float(np.sqrt(max(self.P[0, 0], 0.0)))