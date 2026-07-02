import os

# --- Postgres (same DB your Node backend uses — read-only access here) ---
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/bustracker")

# --- Redis (same instance your Node backend uses) ---
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD") or None

# --- Prediction behavior ---
# How long a trip can go quiet before we start publishing predicted
# positions instead of waiting for real GPS.
STALE_THRESHOLD_S = float(os.getenv("STALE_THRESHOLD_S", "10"))

# How often the background loop ticks and (re)publishes a predicted
# location for every stale trip.
PREDICT_TICK_S = float(os.getenv("PREDICT_TICK_S", "3"))

# If a trip hasn't had a real fix in this long, stop predicting for it
# entirely and drop its in-memory state (matches your Redis TTL of 2h).
TRIP_IDLE_EXPIRE_S = float(os.getenv("TRIP_IDLE_EXPIRE_S", "7200"))

# --- Speed model fallbacks / sanity bounds ---
DEFAULT_SPEED_MPS = float(os.getenv("DEFAULT_SPEED_MPS", "8.0"))   # ~29 km/h, generic city-bus fallback
MAX_SPEED_MPS = float(os.getenv("MAX_SPEED_MPS", "33.0"))          # ~120 km/h sanity clamp

# IANA timezone the bus system actually operates in. minute_of_day /
# day_of_week features for the speed model are computed in this timezone,
# not UTC — otherwise "rush hour" learned by the model is shifted by
# whatever the UTC offset is for this region.
TIMEZONE = os.getenv("TIMEZONE", "Asia/Kolkata")

# --- Off-route handling ---
# If a GPS fix lands further than this from the route line, it's treated
# as suspect (wrong route assignment, a real detour, bad map-matching)
# rather than a normal, trustworthy position update.
OFF_ROUTE_ANOMALY_M = float(os.getenv("OFF_ROUTE_ANOMALY_M", "80.0"))

# How much to inflate the GPS position measurement variance (R) when a fix
# is beyond OFF_ROUTE_ANOMALY_M, so the filter leans on it less.
OFF_ROUTE_VARIANCE_MULTIPLIER = float(os.getenv("OFF_ROUTE_VARIANCE_MULTIPLIER", "8.0"))
