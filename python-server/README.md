# Bus Location Predictor

Predicts a bus's current location during GPS/network dead zones, using a
Kalman filter fused with a historical ML speed model — without requiring
any changes to your existing Node/TypeScript backend.

## The algorithm

Instead of tracking raw `(lat, lon)`, the filter tracks a single scalar:
**`s` — distance travelled along the bus's known route path**, plus
velocity `v`. Since the bus is physically constrained to its route, this
is far more robust than 2D dead-reckoning: predicted points stay snapped
to the road and follow curves correctly.

**State:** `[s, v]` — a standard constant-velocity Kalman filter (2x2).

**Two measurement sources feed the same filter:**

1. **Real GPS fixes** (`H = [1, 0]`): when a map-matched fix arrives, it's
   projected onto the route path to get `s`, and used as a precise,
   low-noise position measurement (plus a velocity measurement, if the
   device reports speed).
2. **Historical speed model** (`H = [0, 1]`): an ML model trained on past
   trips predicts the *expected* speed at this route position and time of
   day/week. This is fed as a continuous, moderate-confidence velocity
   measurement — **always**, every tick, whether or not GPS is present.

**Why this handles dead zones correctly, not just "freezes the last
known speed":** when GPS stops arriving, the filter's uncertainty (`P`)
grows with every `predict()` step. That growing uncertainty *increases
the Kalman gain* for the next measurement it receives — which, during a
dead zone, is only the historical speed model. So the filter
automatically shifts its trust toward the learned historical speed the
longer the gap goes on. That's a property of the Kalman math itself, not
a hand-tuned "blend last-speed with average-speed" heuristic — which
matters because a raw last-known velocity can be misleading (e.g. the bus
was braking for a light right as it lost signal, or there's a curve
ahead the last velocity doesn't reflect).

The filter's own uncertainty (`sqrt(P[0][0])`) is exposed directly as
`accuracy_radius_m` — so the frontend can render a shrinking/growing
"confidence circle" around the predicted point instead of a falsely
precise pin.

## How it plugs into your existing system — no Node changes required

- It reads route/stop shape straight from your existing Postgres
  `route_stop` table (read-only), the same data your `getStops` endpoint
  uses.
- It **subscribes to the same `processed_data` Redis channel** your
  Node `redisSubscriber.ts` already publishes to, to learn about real
  GPS fixes as they happen.
- When a trip goes quiet longer than `STALE_THRESHOLD_S` (default 10s),
  a background loop **publishes synthetic locations onto that same
  channel** with `predicted: true` and `map_matched: false`. Your
  existing Socket.io broadcaster picks these up exactly like real
  updates — the frontend doesn't need to know the difference unless you
  want it to (it can use the `predicted` flag and `accuracy_radius_m` to
  render differently, e.g. a dashed/fading marker).

So this runs as a fully independent service alongside your existing
Node backend, reading the same DB and Redis instance.

## Running it

```bash
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:pass@host:5432/bustracker
export REDIS_HOST=your-redis-host
export REDIS_PASSWORD=your-redis-password
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Endpoints

- `GET /health` — liveness check.
- `GET /trips/{trip_id}/predict` — on-demand prediction (mainly for
  testing; normal operation doesn't need this, the background loop
  handles it automatically).
- `POST /model/train` — feed historical speed samples to train/update
  the per-route speed model (see below).

## Training the historical speed model (the ML part)

The model needs `(route_id, progress_fraction, minute_of_day,
day_of_week, speed_mps)` samples from **completed** trips. Your current
system stores live location history in Redis (`trip:{id}:locs`) but it
expires after 2 hours (`LOCATION_TTL_SECONDS`) and is never persisted
long-term — so there's currently no historical archive to learn from.

**Recommended addition** (small, optional, on the Node side): when a
trip ends, before the Redis key expires, read `trip:{id}:locs`, compute
each point's `progress_fraction` (you'd need the route's `total_length`,
which this service can expose, or compute similarly on the Node side),
and forward the samples to `POST /model/train`. Something like:

```typescript
// in endTrip, after marking the trip completed
const rawLocs = await redisClient.lRange(`trip:${tripId}:locs`, 0, -1);
// ...compute progress_fraction per point using the route's stop distances...
await fetch("http://predictor-service:8000/model/train", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ samples }),
});
```

Until you have enough samples for a route (default threshold: 200), the
model falls back to a simple per-route average speed, then a global
default (`DEFAULT_SPEED_MPS`) — so it degrades gracefully rather than
producing garbage predictions on a brand-new route.

## Notes / things intentionally left out for now

- **Single-instance only.** `registry.py`'s in-memory trip map won't
  work across multiple instances of this service — same caveat as your
  Node backend right now. Flagged in the code where it matters.
- **No auth** on the `/model/train` endpoint — consistent with your
  current stance on the rest of the system; add it whenever you add
  auth elsewhere.
- **`RoutePath` currently uses straight lines between stops.** This
  works but isn't perfectly road-accurate on routes with long gaps
  between stops. If you want tighter accuracy, generate a full-resolution
  polyline once per route (e.g. a single OSRM/LocationIQ Directions call
  between ordered stops, cached), and pass that array of points into
  `RoutePath` instead of just the stop coordinates — nothing else in the
  algorithm needs to change.