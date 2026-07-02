import { asc, eq } from "drizzle-orm";
import { db } from "../database/dbConnection";
import { routeStop } from "../database/schema/route.schema";
import { redisClient } from "../redis/redisConnection";

const PREDICTOR_SERVICE_URL = process.env.PREDICTOR_SERVICE_URL || "http://localhost:8000";
const TIMEZONE = process.env.TIMEZONE || "Asia/Kolkata"; 

const METERS_PER_DEG_LAT = 111_320.0;
const MIN_SAMPLE_DT_S = 2;          
const MAX_SAMPLE_DT_S = 120;        
const MAX_REALISTIC_SPEED_MPS = 33;

type RawLoc = { lat: number; lon: number; ts: number };

type TrainingSample = {
  route_id: string;
  progress_fraction: number;
  minute_of_day: number;
  day_of_week: number;
  speed_mps: number;
};

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


function toLocalMeters(lat: number, lon: number, originLat: number, originLon: number) {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return { x: (lon - originLon) * metersPerDegLon, y: (lat - originLat) * METERS_PER_DEG_LAT };
}

type RoutePolyline = { points: { lat: number; lng: number }[]; cumDist: number[]; totalLength: number };

async function buildRoutePolyline(routeId: string): Promise<RoutePolyline | null> {
  const stops = await db
    .select()
    .from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  if (stops.length < 2) return null;

  const points = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const cumDist = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cumDist.push(cumDist[cumDist.length - 1] + haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng));
  }
  return { points, cumDist, totalLength: cumDist[cumDist.length - 1] };
}


function projectOntoRoute(lat: number, lon: number, path: RoutePolyline): number {
  let bestS = 0;
  let bestDist = Infinity;

  for (let i = 0; i < path.points.length - 1; i++) {
    const A = path.points[i];
    const B = path.points[i + 1];

    const { x: bx, y: by } = toLocalMeters(B.lat, B.lng, A.lat, A.lng);
    const { x: px, y: py } = toLocalMeters(lat, lon, A.lat, A.lng);

    const segLenSq = bx * bx + by * by;
    let t = segLenSq === 0 ? 0 : (px * bx + py * by) / segLenSq;
    t = Math.max(0, Math.min(1, t));

    const dist = Math.hypot(px - t * bx, py - t * by);
    const segLenM = path.cumDist[i + 1] - path.cumDist[i];
    const s = path.cumDist[i] + t * segLenM;

    if (dist < bestDist) {
      bestDist = dist;
      bestS = s;
    }
  }
  return bestS;
}


function localTimeParts(ts: number): { minuteOfDay: number; dayOfWeek: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date(ts));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

  const hour = parseInt(get("hour"), 10) % 24; 
  const minute = parseInt(get("minute"), 10);
  const weekdayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  return { minuteOfDay: hour * 60 + minute, dayOfWeek: weekdayMap[get("weekday")] ?? 0 };
}


async function buildTrainingSamples(tripId: string, routeId: string): Promise<TrainingSample[]> {
  const raw = await redisClient.lRange(`trip:${tripId}:locs`, 0, -1);
  if (raw.length < 2) return [];

  const path = await buildRoutePolyline(routeId);
  if (!path || path.totalLength <= 0) return [];

  const locs: RawLoc[] = raw.map((r) => JSON.parse(r));
  const samples: TrainingSample[] = [];

  for (let i = 0; i < locs.length - 1; i++) {
    const p1 = locs[i];
    const p2 = locs[i + 1];

    const dtS = (p2.ts - p1.ts) / 1000;
    if (dtS < MIN_SAMPLE_DT_S || dtS > MAX_SAMPLE_DT_S) continue;

    const speedMps = haversineM(p1.lat, p1.lon, p2.lat, p2.lon) / dtS;
    if (speedMps > MAX_REALISTIC_SPEED_MPS) continue;

    const progressFraction = Math.min(1, Math.max(0, projectOntoRoute(p1.lat, p1.lon, path) / path.totalLength));
    const { minuteOfDay, dayOfWeek } = localTimeParts(p1.ts);

    samples.push({
      route_id: routeId,
      progress_fraction: progressFraction,
      minute_of_day: minuteOfDay,
      day_of_week: dayOfWeek,
      speed_mps: speedMps,
    });
  }
  return samples;
}

// Forwards a Completed Trip's History to the Predictor Service.
export async function sendTrainingSamples(tripId: string, routeId: string): Promise<void> {
  try {
    const samples = await buildTrainingSamples(tripId, routeId);
    if (!samples.length) return;

    const response = await fetch(`${PREDICTOR_SERVICE_URL}/model/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ samples }),
    });

    if (!response.ok) {
      console.error(`[training] predictor service returned ${response.status}: ${await response.text()}`);
      return;
    }
    console.log(`[training] forwarded ${samples.length} samples for trip ${tripId}`);
  } catch (err) {
    console.error(`[training] failed to forward samples for trip ${tripId}:`, err);
  }
}