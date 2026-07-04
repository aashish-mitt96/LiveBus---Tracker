from typing import Optional
from sqlalchemy.engine import Engine
from sqlalchemy import create_engine

from ..config import DATABASE_URL

_engine: Optional[Engine] = None



# Create & Reuse a Single Database Engine.
def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    return _engine