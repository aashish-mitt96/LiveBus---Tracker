import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the python-server root regardless of the working
# directory the process was launched from.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

# 1. Database.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bus_tracker")


# 2. Speed Model.
DEFAULT_SPEED_MPS    = float(os.getenv("DEFAULT_ETA_SPEED_MPS", "6.5"))
MIN_TRAINING_SAMPLES = int(os.getenv("MIN_TRAINING_SAMPLES", "20"))
KALMAN_STEP_SECONDS  = float(os.getenv("KALMAN_STEP_SECONDS", "5"))


# 3. Anomaly Detection.
DEFAULT_VELOCITY_VARIANCE = float(os.getenv("DEFAULT_VELOCITY_VARIANCE", "4.0"))
PROCESS_ACCEL_VARIANCE    = float(os.getenv("PROCESS_ACCEL_VARIANCE", "0.35"))


# 4. Timezone.
TIMEZONE = os.getenv("TIMEZONE", "Asia/Kolkata")


# 5. Cache.
ROUTE_CACHE_TTL_SECONDS = float(os.getenv("ROUTE_CACHE_TTL_SECONDS", "300"))
MODEL_CACHE_TTL_SECONDS = float(os.getenv("MODEL_CACHE_TTL_SECONDS", "60"))