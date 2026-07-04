import os

# Same Postgres instance Node uses. This service reads route/route_stop
# directly (it needs route geometry for basically everything) and owns
# reads/writes to route_segment_speed.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bus_tracker")

# Where per-route trained models are persisted (joblib) + the accumulating
# per-route training corpus (json lines). Mount this as a volume in prod so
# models survive restarts/deploys.
MODEL_DIR = os.getenv("MODEL_DIR", "./models")
os.makedirs(MODEL_DIR, exist_ok=True)

# Kept in sync with Node's DEFAULT_ETA_SPEED_MPS (eta.service.ts) so the two
# services degrade to the same fallback number when nothing smarter is
# available yet (brand-new route, no trained model, no segment history).
DEFAULT_SPEED_MPS = float(os.getenv("DEFAULT_ETA_SPEED_MPS", "6.5"))

# Minimum point-pairs required before we trust a freshly trained model's
# output over the plain default speed.
MIN_TRAINING_SAMPLES = int(os.getenv("MIN_TRAINING_SAMPLES", "20"))

# Kalman filter step size used while extrapolating through a dead zone.
KALMAN_STEP_SECONDS = float(os.getenv("KALMAN_STEP_SECONDS", "5"))

# How much we trust the ML model's velocity "measurement" at each Kalman
# update step, expressed as measurement variance ((m/s)^2). A trained model
# overrides this with its own residual variance from training; this is just
# the floor used before any model exists for a route.
DEFAULT_VELOCITY_VARIANCE = float(os.getenv("DEFAULT_VELOCITY_VARIANCE", "4.0"))

# Process noise (acceleration variance) driving how fast the Kalman filter's
# uncertainty grows per second spent in a dead zone with no corrections.
PROCESS_ACCEL_VARIANCE = float(os.getenv("PROCESS_ACCEL_VARIANCE", "0.35"))

TIMEZONE = os.getenv("TIMEZONE", "Asia/Kolkata")