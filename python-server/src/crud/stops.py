# src/crud/stops.py
import requests
import os
import json
import redis

# ✅ Connect using RedisLabs credentials from .env (same as your location tracking)
r = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    password=os.getenv("REDIS_PASSWORD"),
    decode_responses=True,
    ssl=False  # RedisLabs requires SSL
)


def get_place_name(lat: float, lng: float) -> str:
    api_key = os.getenv("LOCATIONIQ_TOKEN")
    url = f"https://us1.locationiq.com/v1/reverse?key={api_key}&lat={lat}&lon={lng}&format=json"
    try:
        res = requests.get(url, timeout=5)
        addr = res.json().get("address", {})
        return (
            addr.get("amenity") or
            addr.get("road") or
            addr.get("neighbourhood") or
            addr.get("suburb") or
            addr.get("village") or
            addr.get("town") or
            addr.get("city") or
            addr.get("county") or
            addr.get("state_district") or
            addr.get("state") or
            "Unknown"
        )
    except Exception as e:
        print(f"[locationiq] exception: {e}")
        return "Unknown"


def buffer_stop(trip_id: str, lat: float, lng: float) -> str:
    """Resolve place name and push stop to Redis buffer. Returns resolved name."""
    name = get_place_name(lat, lng)
    stop = json.dumps({"lat": lat, "lng": lng, "stop_name": name})
    redis_key = f"trip:{trip_id}:pending_stops"
    r.rpush(redis_key, stop)
    # Safety TTL: auto-expire after 24h in case trip never ends
    r.expire(redis_key, 86400)
    print(f"[buffer_stop] buffered '{name}' for trip {trip_id}")
    return name


def flush_stops_to_node(trip_id: str) -> bool:
    """Read all buffered stops from Redis and send them to Node one by one, then clear."""
    NODE_URL = os.getenv("NODE_URL", "http://localhost:3000")
    redis_key = f"trip:{trip_id}:pending_stops"

    raw_stops = r.lrange(redis_key, 0, -1)
    if not raw_stops:
        print(f"[flush_stops] no pending stops for trip {trip_id}")
        return True

    print(f"[flush_stops] flushing {len(raw_stops)} stops for trip {trip_id}")

    all_ok = True
    for raw in raw_stops:
        try:
            stop = json.loads(raw)
            res = requests.patch(
                f"{NODE_URL}/bus/trip/{trip_id}/route",
                json=stop,
                headers={"x-internal": "true"},
                timeout=5
            )
            data = res.json()
            print(f"[flush_stops] pushed '{stop['stop_name']}' → skipped={data.get('skipped')}")
        except Exception as e:
            print(f"[flush_stops] ❌ failed to push stop: {e}")
            all_ok = False

    # Clear buffer regardless — don't retry on partial failure to avoid duplicates
    r.delete(redis_key)
    print(f"[flush_stops] cleared Redis buffer for trip {trip_id}")
    return all_ok