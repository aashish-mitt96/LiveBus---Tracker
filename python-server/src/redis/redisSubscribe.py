import json
import os
import httpx
from src.redis.redisConnection import redis_client
from src.redis.redisPublish import publish_to_redis
from dotenv import load_dotenv

load_dotenv()  # load .env variables

LOCATION_TTL_SECONDS = 7200
LOCATIONIQ_TOKEN = os.getenv("LOCATIONIQ_TOKEN")
LOCATIONIQ_MATCH_URL = os.getenv("LOCATION_MATCH_URL")

# Sliding window of raw points per trip for map matching
bus_raw_window = {}
MATCH_WINDOW_SIZE = 2


def snap_to_road(window: list[dict]) -> tuple[float, float] | None:
    if len(window) < 2:
        return None

    try:
        coords = ";".join(f"{p['lon']},{p['lat']}" for p in window)
        url = f"https://us1.locationiq.com/v1/matching/driving/{coords}"

        # ✅ Convert ms → seconds if needed (LocationIQ requires Unix seconds)
        def to_seconds(ts):
            t = int(ts)
            return t // 1000 if t > 1_000_000_000_000 else t

        ts_list = [to_seconds(p["ts"]) for p in window]

        params = {
            "key":         LOCATIONIQ_TOKEN,
            "timestamps":  ";".join(str(t) for t in ts_list),
            "radiuses":    ";".join("15" for _ in window),
            "geometries":  "geojson",
            "annotations": "false",
            "overview":    "false",
        }

        response = httpx.get(url, params=params, timeout=5.0)
        response.raise_for_status()
        data = response.json()

        tracepoints = data.get("tracepoints", [])
        if not tracepoints:
            return None

        last_tp = tracepoints[-1]
        if last_tp is None:
            return None

        snapped_lon, snapped_lat = last_tp["location"]
        return snapped_lat, snapped_lon

    except httpx.HTTPStatusError as e:
        print(f"[map_match] HTTP error {e.response.status_code}: {e.response.text}")
        return None
    except Exception as e:
        print(f"[map_match] Unexpected error: {e}")
        return None


def subscribe_to_redis():
    pubsub = redis_client.pubsub()
    pubsub.subscribe("raw_location")
    print("Subscribed to Redis channel: raw_location")

    for message in pubsub.listen():
        if message['type'] != 'message':
            continue

        raw_data = json.loads(message['data'])

        trip_id = raw_data.get("tripId")
        if not trip_id:
            continue

        ts = raw_data.get("timestamp", redis_client.time()[0])

        # ── 1. Append new point to window ─────────────────────────────────────
        if trip_id not in bus_raw_window:
            bus_raw_window[trip_id] = []

        window = bus_raw_window[trip_id]
        window.append({
            "lat": raw_data["lat"],
            "lon": raw_data["lon"],
            "ts":  ts,
        })
        if len(window) > MATCH_WINDOW_SIZE:
            window.pop(0)

        # ── 2. Snap to road — called on EVERY ping, no waiting ────────────────
        # Window gives LocationIQ directional context for better accuracy,
        # but we always publish immediately using the LATEST point's snapped pos.
        # Even with window size 1 (first ping), snap_to_road handles it by
        # falling back to raw, so there's zero delay ever.
        snapped = snap_to_road(window)

        if snapped:
            lat, lon = snapped
            map_matched = True
            print(
                f"[map_match] {trip_id} "
                f"raw({raw_data['lat']:.6f},{raw_data['lon']:.6f}) → "
                f"road({lat:.6f},{lon:.6f})"
            )
        else:
            lat, lon = raw_data["lat"], raw_data["lon"]
            map_matched = False
            print(f"[map_match] {trip_id} — falling back to raw GPS")

        # ── 3. Build output payload ───────────────────────────────────────────
        processed_data = {
            "tripId":      trip_id,
            "lat":         lat,
            "lon":         lon,
            "velocity":    raw_data.get("vel", 0),
            "timestamp":   ts,
            "map_matched": map_matched,
        }

        # ── 4. Store + publish immediately ────────────────────────────────────
        key = f"trip:{trip_id}:locs"
        redis_client.rpush(key, json.dumps({"lat": lat, "lon": lon, "ts": ts}))
        redis_client.expire(key, LOCATION_TTL_SECONDS)

        publish_to_redis(processed_data)