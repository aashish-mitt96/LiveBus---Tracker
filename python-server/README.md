# Bus Route Predictor (FastAPI)

Fills GPS dead zones by extrapolating a bus's position along its route,
using a per-route ML speed model + a Kalman filter. Trains itself
incrementally off the training samples your Node backend already sends.

## Run it

```bash
cd predictor-service
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:pass@host:5432/bus_tracker
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Set `PREDICTOR_SERVICE_URL=http://localhost:8000` on the Node side (it's
already used by `training.service.ts` — no new env var needed there).

## What you need to do on the Node/DB side

1. Run `node-changes/migration_route_segment_speed.sql` against Postgres
   (or fold it into a drizzle-kit migration — the accompanying
   `route.schema.ts` already has the `routeSegmentSpeed` table added).
2. Replace `redis/redisLocation.ts` with `node-changes/redisLocation.ts`.
   Everything else (endTrip → sendTrainingSamples, ETA, search) is
   untouched — training already flows to `/model/train` with the payload
   your `training.service.ts` already builds.
3. Nothing else changes. No new Node routes, no new controllers.

## Endpoints

### `POST /model/train`
Same payload Node already sends from `sendTrainingSamples`:
```json
{ "samples": [
  { "route_id": "...", "progress_fraction": 0.31, "minute_of_day": 512, "day_of_week": 2, "speed_mps": 7.4 }
] }
```
- Appends samples to that route's persistent training corpus and refits
  its `HistGradientBoostingRegressor`.
- Buckets the same samples by which stop-to-stop segment they fall in and
  merges a running-average speed into `route_segment_speed`.
- No-ops gracefully (falls back to defaults) until a route has accumulated
  `MIN_TRAINING_SAMPLES` (default 20).

### `POST /predict`
Called by Node's dead-zone watchdog when a trip's `raw_location` pings go
silent for `DEAD_ZONE_TIMEOUT_MS` (default 20s):
```json
{
  "trip_id": "...", "route_id": "...",
  "last_known": { "lat": 28.6, "lon": 77.2, "timestamp": 1720000000000, "velocity": 6.2 },
  "now": 1720000030000
}
```
Returns an extrapolated `lat/lon`, the Kalman filter's velocity estimate,
and `confidence_radius_m` (grows the longer GPS stays silent — good for
showing a shrinking-confidence circle on the map instead of a fake-precise
pin).

## Design notes / known limitations

- **Corpus, not online learning.** Raw GPS only lives 2h in Redis, so each
  route's full history is kept as a small JSONL file under `MODEL_DIR` and
  refit from scratch on every training call. Fine at bus-route data
  volumes; revisit if a route racks up tens of thousands of points.
- **Segment identity is stop-id based, not seq-based.** If someone later
  inserts a new mid-route stop via `pin-stop`, the old two-stop segment
  that used to span across it becomes stale and the two new smaller
  segments start with zero samples until retrained. Cheap to accept for
  v1; flag if this becomes a problem.
- **Kalman filter only runs during dead zones**, per your call — it does
  not fuse with live GPS or replace LocationIQ map-matching.
- **Concurrency**: `upsert_segment_speed` does a read-then-write inside one
  transaction; two trips on the same route ending in the same instant
  could theoretically race. Not a realistic concern at expected trip
  volumes, but worth knowing.
- Model storage (`MODEL_DIR`) and the training corpus both need to live on
  a persistent volume in production — they're just local files.