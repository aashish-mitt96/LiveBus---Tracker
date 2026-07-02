from typing import Optional
from .. import config

import asyncpg


# Shared Database Connection Pool.
_pool: Optional[asyncpg.Pool] = None


# Create the PostgreSQL Connection Pool.
async def init_db_pool():
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=config.DATABASE_URL,
        min_size=1,
        max_size=5
    )


# Close the Connection Pool.
async def close_db_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# Accessor for the current pool.
def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized — call init_db_pool() first")
    return _pool