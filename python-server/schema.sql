-- python-server/schema.sql
--
-- Tables owned and queried directly (via raw SQL / SQLAlchemy `text()`)
-- by the Python predictor service. These are NOT managed by Drizzle
-- (node-server), so they must be created manually against the same
-- Postgres/Neon database used by node-server.
--
-- Run this once against your database:
--   psql "$DATABASE_URL" -f schema.sql
-- or paste it into the Neon SQL console.

-- Used by app/models/speed_model.py (insert_training_samples, _fetch_all_samples)
-- Stores raw (progress_fraction, time-of-day, speed) observations collected
-- from completed trips, used to train each route's speed model.
CREATE TABLE IF NOT EXISTS route_speed_training_sample (
    id                SERIAL PRIMARY KEY,
    route_id          TEXT NOT NULL,
    progress_fraction DOUBLE PRECISION NOT NULL,
    minute_of_day     INTEGER NOT NULL,
    day_of_week       INTEGER NOT NULL,
    speed_mps         DOUBLE PRECISION NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_speed_training_sample_route_id
    ON route_speed_training_sample (route_id);


-- Used by app/models/speed_model.py (RouteSpeedModel.load, _save_model)
-- Stores the latest trained model (serialized via joblib) and its
-- residual variance / sample count for each route.
CREATE TABLE IF NOT EXISTS route_speed_model (
    route_id       TEXT PRIMARY KEY,
    estimator_blob BYTEA,
    residual_std   DOUBLE PRECISION NOT NULL,
    sample_count   INTEGER NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Used by app/services/shared_config.py (get_default_speed_mps)
-- Optional DB-driven config overrides. Reads currently fail silently
-- (wrapped in try/except) and fall back to DEFAULT_ETA_SPEED_MPS from
-- the environment if this table doesn't exist or has no matching row,
-- so this table is not strictly required -- but is included for
-- completeness and so the fallback isn't the *only* path.
CREATE TABLE IF NOT EXISTS service_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Example seed row (optional):
-- INSERT INTO service_config (key, value) VALUES ('default_eta_speed_mps', '6.5')
-- ON CONFLICT (key) DO NOTHING;