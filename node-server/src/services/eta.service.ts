import { asc, eq } from "drizzle-orm";
import { db } from "../database/dbConnection";
import { routeStop, routeSegmentSpeed } from "../database/schema/route.schema";
import { redisClient } from "../redis/redisConnection";
import { buildRoutePath, PathPoint, projectOntoPath } from "../utils/route.utils";


const DEFAULT_SPEED_MPS = Number(process.env.DEFAULT_ETA_SPEED_MPS) || 6.5;

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
  etaTimestamp:       number | null;
  passed:             boolean;
};

export type TripEtaResult = {
  hasLiveLocation: boolean;
  current: { lat: number; lon: number; timestamp: number } | null;
  currentSegmentSpeedMps: number | null; 
  stops: StopEta[];
  routeMappingIncomplete: boolean;
};


async function loadSegmentSpeeds(routeId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(routeSegmentSpeed).where(eq(routeSegmentSpeed.routeId, routeId));
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.fromStopId}:${row.toStopId}`, row.avgSpeedMps);
  }
  return map;
}


export async function computeTripEta(routeId: string, tripId: string): Promise<TripEtaResult | null> {

  // Fetch the route's stops in travel order.
  const stops = await db.select().from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  if (stops.length < 2) return null;

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

  const segmentSpeedMap = await loadSegmentSpeeds(routeId);
  const segSpeeds: number[] = [];
  for (let j = 0; j < stops.length - 1; j++) {
    const key = `${stops[j].id}:${stops[j + 1].id}`;
    segSpeeds.push(segmentSpeedMap.get(key) ?? DEFAULT_SPEED_MPS);
  }

  const segTimes: number[] = segSpeeds.map((speed, j) => {
    const segLen = path.cumDist[j + 1] - path.cumDist[j];
    return segLen / speed;
  });
  const cumSegTime: number[] = [0];
  for (let j = 0; j < segTimes.length; j++) {
    cumSegTime.push(cumSegTime[cumSegTime.length - 1] + segTimes[j]);
  }

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