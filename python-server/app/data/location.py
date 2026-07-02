import json
from typing import Optional
from ..connectors.redis import get_client


async def publish_processed_location(payload: dict):
    client = get_client()
    await client.publish("processed_data", json.dumps(payload))


async def get_last_location(trip_id: str) -> Optional[dict]:
    client = get_client()
    raw = await client.get(f"lastLocation:{trip_id}")
    return json.loads(raw) if raw else None