import { asc, eq } from "drizzle-orm";
import { db } from "../database/dbConnection";
import { routeStop } from "../database/schema/route.schema";
import { redisClient } from "../redis/redisConnection";
import { buildRoutePath, projectOntoPath, PathPoint } from "./geo.service";


// Fallback average speed (m/s) used whenever we don't have a trustworthy live
// speed reading yet — roughly 23 km/h, a reasonable in-city bus average
// once you factor in traffic lights and stops.
const DEFAULT_SPEED_MPS = Number(process.env.DEFAULT_ETA_SPEED_MPS) || 6.5;

// Below this speed we don't trust the instantaneous GPS speed (bus could be
// idling at a signal) and fall back to the default average instead.
const MIN_TRUSTED_SPEED_MPS = 1.0;

// Treat the bus as having "reached" a stop once it's within this many
// meters of it, to absorb GPS/map-matching jitter around the exact point.
const STOP_REACHED_TOLERANCE_M = 5;


export type StopEta = {
  seq:                number;
  stopName:           string;
  lat:                number;
  lng:                number;
  isTerminal:         boolean;
  distanceRemainingM: number | null;
  etaSeconds:         number | null;
  etaMinutes:         number | null;
  etaTimestamp:       number | null; // epoch ms
  passed:             boolean;
};

export type TripEtaResult = {
  hasLiveLocation: boolean;
  current: { lat: number; lon: number; velocity: number; timestamp: number } | null;
  speedUsedMps: number;
  stops: StopEta[];
};


// Compute an ETA for every stop on a trip's route, based on the last known
// (live or predicted) location cached in Redis by the location pipeline.
export async function computeTripEta(routeId: string, tripId: string): Promise<TripEtaResult | null> {

  // Fetch the route's stops in travel order.
  const stops = await db.select().from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  if (stops.length < 2) return null;

  const points: PathPoint[] = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const path = buildRoutePath(points);

  // Read the latest known location (published by the Node location pipeline
  // or the Python dead-zone predictor — either way it lands on this key).
  let current: { lat: number; lon: number; velocity: number; timestamp: number } | null = null;
  try {
    const raw = await redisClient.get(`lastLocation:${tripId}`);
    if (raw) {
      const parsed = JSON.parse(raw as string);
      current = {
        lat:       parsed.lat,
        lon:       parsed.lon,
        velocity:  typeof parsed.velocity === "number" ? parsed.velocity : 0,
        timestamp: parsed.timestamp ?? Date.now(),
      };
    }
  } catch (err) {
    console.error("[eta] failed to read last known location:", err);
  }

  // No location yet (trip hasn't sent a ping) — ETAs are unknown for now.
  if (!current) {
    return {
      hasLiveLocation: false,
      current: null,
      speedUsedMps: DEFAULT_SPEED_MPS,
      stops: stops.map((s) => ({
        seq:                s.seq,
        stopName:           s.stopName,
        lat:                s.lat,
        lng:                s.lng,
        isTerminal:         s.isTerminal,
        distanceRemainingM: null,
        etaSeconds:         null,
        etaMinutes:         null,
        etaTimestamp:       null,
        passed:             false,
      })),
    };
  }

  const currentS = projectOntoPath(current.lat, current.lon, path);
  const speed    = current.velocity >= MIN_TRUSTED_SPEED_MPS ? current.velocity : DEFAULT_SPEED_MPS;
  const now      = Date.now();

  const stopEtas: StopEta[] = stops.map((s, idx) => {
    const stopS  = path.cumDist[idx];
    const passed = stopS <= currentS + STOP_REACHED_TOLERANCE_M;

    if (passed) {
      return {
        seq: s.seq, stopName: s.stopName, lat: s.lat, lng: s.lng, isTerminal: s.isTerminal,
        distanceRemainingM: 0, etaSeconds: 0, etaMinutes: 0, etaTimestamp: now, passed: true,
      };
    }

    const remainingM  = stopS - currentS;
    const etaSeconds  = remainingM / speed;

    return {
      seq: s.seq, stopName: s.stopName, lat: s.lat, lng: s.lng, isTerminal: s.isTerminal,
      distanceRemainingM: Math.round(remainingM),
      etaSeconds:         Math.round(etaSeconds),
      etaMinutes:         Math.round(etaSeconds / 60),
      etaTimestamp:       now + etaSeconds * 1000,
      passed:             false,
    };
  });

  return { hasLiveLocation: true, current, speedUsedMps: speed, stops: stopEtas };
}