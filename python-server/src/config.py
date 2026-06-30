# # src/config.py
# import os
# from dotenv import load_dotenv

# load_dotenv()

# class Config:
#     SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
#     SQLALCHEMY_TRACK_MODIFICATIONS = False


# src/config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ── Connection pool settings ───────────────────────────────────────────
    # Without these, SQLAlchemy defaults to pool_size=5 which is fine for
    # HTTP requests but causes contention when your ThreadPoolExecutor
    # (max_workers=20) tries to run DB queries simultaneously.
    #
    # pool_size     = connections kept open and ready (warm, fast to borrow)
    # max_overflow  = extra connections allowed when pool is full (then destroyed after use)
    # pool_timeout  = seconds to wait for a connection before raising error
    # pool_recycle  = recycle connections after this many seconds (prevents stale connections)
    #
    # Your ThreadPoolExecutor has max_workers=20, but stops are rare events,
    # so pool_size=10 is more than enough. Most threads just do arithmetic.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size":    10,
        "max_overflow": 5,
        "pool_timeout": 10,
        "pool_recycle": 1800,
        "pool_pre_ping": True,   # checks connection health before using it
    }