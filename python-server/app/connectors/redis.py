from typing import Optional
import redis.asyncio as redis
from .. import config

_client: Optional[redis.Redis] = None


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis(
            host=config.REDIS_HOST,
            port=config.REDIS_PORT,
            password=config.REDIS_PASSWORD,
            decode_responses=True,
        )
    return _client