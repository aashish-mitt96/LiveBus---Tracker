import { asc, eq } from "drizzle-orm";
import { db } from "../database/dbConnection";
import { routeStop, routeSegmentSpeed } from "../database/schema/route.schema";
import { redisClient } from "../redis/redisConnection";
import { buildRoutePath, PathPoint, projectOntoPath } from "./geo.service";

// Fallback speed (m/s) used for any segment that hasn't accumulated enough
// trip history yet — roughly 23 km/h, a reasonable in-city bus average.
// Same number Node and the predictor service already agree on.
const DEFAULT_SPEED_MPS = Number(process.env.DEFAULT_ETA_SPEED_MPS) || 6.5;

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
  current: { lat: number; lon: number; timestamp: number } | null;
  currentSegmentSpeedMps: number | null; // informational — speed used for the segment the bus is on right now
  stops: StopEta[];
  // True when the route's destination hasn't been resolved from a placeholder
  // yet (brand-new route, trip still in progress) — every ETA below is a
  // definitionally meaningless placeholder ("passed"/0s) and should be
  // rendered as "unknown" rather than trusted.
  routeMappingIncomplete: boolean;
};


// Build a lookup of this route's known average speed (m/s) per
// (fromStopId -> toStopId) segment, as maintained by the predictor service
// after every completed trip. Missing entries fall back to DEFAULT_SPEED_MPS.
async function loadSegmentSpeeds(routeId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(routeSegmentSpeed).where(eq(routeSegmentSpeed.routeId, routeId));
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.fromStopId}:${row.toStopId}`, row.avgSpeedMps);
  }
  return map;
}


// Compute an ETA for every stop on a trip's route, using purely historical
// average speeds per segment (route_segment_speed) — no live GPS velocity
// involved. The bus's *position* still comes from the live/last-known
// location cache (real GPS or a dead-zone prediction, doesn't matter which);
// only the *speed* used to convert remaining distance into time is now
// always the historical average for each segment travelled.
export async function computeTripEta(routeId: string, tripId: string): Promise<TripEtaResult | null> {

  // Fetch the route's stops in travel order.
  const stops = await db.select().from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  if (stops.length < 2) return null;

  // The destination stop hasn't received its real GPS fix yet (still seeded
  // at trip-start's placeholder coordinates — see trip.controller.ts). The
  // route is geometrically a zero-length path right now, which would make
  // every stop look instantly "passed" if we ran the math below anyway.
  const destinationUnresolved = stops[stops.length - 1].resolved === false;

  const points: PathPoint[] = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const path = buildRoutePath(points);

  if (destinationUnresolved || path.totalLength <= 0) {
    return {
      hasLiveLocation: false,
      current: null,
      currentSegmentSpeedMps: null,
      routeMappingIncomplete: true,
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

  // Per-segment historical average speed, one entry per (stop[j] -> stop[j+1]).
  const segmentSpeedMap = await loadSegmentSpeeds(routeId);
  const segSpeeds: number[] = [];
  for (let j = 0; j < stops.length - 1; j++) {
    const key = `${stops[j].id}:${stops[j + 1].id}`;
    segSpeeds.push(segmentSpeedMap.get(key) ?? DEFAULT_SPEED_MPS);
  }

  // Precompute: time (seconds) to travel each full segment, and a running
  // total "time from route start to stop k" so per-stop ETA is just a
  // couple of array lookups plus one partial-segment adjustment.
  const segTimes: number[] = segSpeeds.map((speed, j) => {
    const segLen = path.cumDist[j + 1] - path.cumDist[j];
    return segLen / speed;
  });
  const cumSegTime: number[] = [0];
  for (let j = 0; j < segTimes.length; j++) {
    cumSegTime.push(cumSegTime[cumSegTime.length - 1] + segTimes[j]);
  }

  // Read the latest known location (published by the Node location pipeline
  // or the Python dead-zone predictor — either way it lands on this key).
  let current: { lat: number; lon: number; timestamp: number } | null = null;
  try {
    const raw = await redisClient.get(`lastLocation:${tripId}`);
    if (raw) {
      const parsed = JSON.parse(raw as string);
      current = {
        lat:       parsed.lat,
        lon:       parsed.lon,
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
      currentSegmentSpeedMps: null,
      routeMappingIncomplete: false,
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
  const now      = Date.now();

  // Which segment is the bus currently on?
  let segIdx = segSpeeds.length - 1;
  for (let j = 0; j < path.cumDist.length - 1; j++) {
    if (currentS <= path.cumDist[j + 1]) { segIdx = j; break; }
  }
  const currentSegmentSpeedMps = segSpeeds[segIdx] ?? DEFAULT_SPEED_MPS;

  const stopEtas: StopEta[] = stops.map((s, idx) => {
    const stopS  = path.cumDist[idx];
    const passed = stopS <= currentS + STOP_REACHED_TOLERANCE_M;

    if (passed) {
      return {
        seq: s.seq, stopName: s.stopName, lat: s.lat, lng: s.lng, isTerminal: s.isTerminal,
        distanceRemainingM: 0, etaSeconds: 0, etaMinutes: 0, etaTimestamp: now, passed: true,
      };
    }

    // Time from currentS to this stop = remainder of the current (partial)
    // segment, at that segment's historical speed, plus the full historical
    // travel time for every complete segment in between.
    const remainderOfCurrentSegmentM = path.cumDist[segIdx + 1] - currentS;
    const timeThroughCurrentSegment  = remainderOfCurrentSegmentM / currentSegmentSpeedMps;
    const timeForFullSegmentsBetween = cumSegTime[idx] - cumSegTime[segIdx + 1];

    const etaSeconds = Math.max(0, timeThroughCurrentSegment + timeForFullSegmentsBetween);
    const remainingM = stopS - currentS;

    return {
      seq: s.seq, stopName: s.stopName, lat: s.lat, lng: s.lng, isTerminal: s.isTerminal,
      distanceRemainingM: Math.round(remainingM),
      etaSeconds:         Math.round(etaSeconds),
      etaMinutes:         Math.round(etaSeconds / 60),
      etaTimestamp:       now + etaSeconds * 1000,
      passed:             false,
    };
  });

  return { hasLiveLocation: true, current, currentSegmentSpeedMps, routeMappingIncomplete: false, stops: stopEtas };
}