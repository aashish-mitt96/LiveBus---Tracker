import os
from dotenv import load_dotenv

load_dotenv()


# 1. Database.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/bustracker")


# 2. Redis.
REDIS_HOST     = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT     = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD") or None


# 3. Prediction.
STALE_THRESHOLD_S  = float(os.getenv("STALE_THRESHOLD_S", "25"))
PREDICT_TICK_S     = float(os.getenv("PREDICT_TICK_S", "3"))
TRIP_IDLE_EXPIRE_S = float(os.getenv("TRIP_IDLE_EXPIRE_S", "7200"))


# 4. Speed Model.
DEFAULT_SPEED_MPS = float(os.getenv("DEFAULT_SPEED_MPS", "8.0"))   
MAX_SPEED_MPS     = float(os.getenv("MAX_SPEED_MPS", "30.0"))          


# 5. Timezone.
TIMEZONE = os.getenv("TIMEZONE", "Asia/Kolkata")


# 6. Anomaly Detection.
OFF_ROUTE_ANOMALY_M           = float(os.getenv("OFF_ROUTE_ANOMALY_M", "80.0"))
OFF_ROUTE_VARIANCE_MULTIPLIER = float(os.getenv("OFF_ROUTE_VARIANCE_MULTIPLIER", "8.0"))