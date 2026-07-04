import os

# Same Postgres instance Node uses. This service reads route/route_stop
# directly (it needs route geometry for basically everything) and owns
# reads/writes to route_segment_speed, route_speed_model, and
# route_speed_training_sample.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bus_tracker")

# NOTE: trained models used to live on local disk (MODEL_DIR) as .joblib
# files, with an accompanying .jsonl training corpus. Both now live in
# Postgres (route_speed_model / route_speed_training_sample — see
# db/schema.sql) so every replica of this service reads the same model
# instead of each holding its own local copy that can drift between
# instances or vanish on redeploy.

# Env var name kept for backwards compatibility with existing deploys; the
# authoritative value now lives in the `service_config` table so this
# service and Node's eta.service.ts read the same number instead of two
# independently-maintained env vars (see services/shared_config.py). This
# is only the fallback used if that table/row isn't reachable yet.
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

# In-memory cache TTLs for /predict's hot path. Route geometry rarely
# changes, so it can sit in cache a long time. Models only change when a
# background retrain finishes and explicitly invalidates the cache entry,
# so this TTL is just a safety net, not the primary invalidation path.
ROUTE_CACHE_TTL_SECONDS = float(os.getenv("ROUTE_CACHE_TTL_SECONDS", "300"))
MODEL_CACHE_TTL_SECONDS = float(os.getenv("MODEL_CACHE_TTL_SECONDS", "60"))
