import { redisClient } from "../redis/redisConnection";

import { haversineM } from "../utils/math.utils";
import { localTimeParts } from "../utils/time.utils";
import { buildRoutePolyline, projectOntoPath } from "../utils/route.utils";

const PREDICTOR_SERVICE_URL = process.env.PREDICTOR_SERVICE_URL || "http://localhost:8000";


const MIN_SAMPLE_DT_S         = 2;
const MAX_SAMPLE_DT_S         = 120;
const MAX_REALISTIC_SPEED_MPS = 33;


type RawLoc = { lat: number; lon: number; ts: number };


type TrainingSample = {
  route_id:          string;
  progress_fraction: number;
  minute_of_day:     number;
  day_of_week:       number;
  speed_mps:         number;
};



// Turn a Trip's Raw GPS Pings into Cleaned Training Samples for the Predictor.
async function buildTrainingSamples(tripId: string, routeId: string): Promise<TrainingSample[]> {

  const raw = await redisClient.lRange(`trip:${tripId}:locs`, 0, -1);
  if (raw.length < 2) return [];

  const path = await buildRoutePolyline(routeId);
  if (!path || path.totalLength <= 0) return [];

  const locs: RawLoc[] = raw.map((r) => JSON.parse(r));
  const samples: TrainingSample[] = [];

  for (let i=0; i<locs.length-1; i++) {
    const p1 = locs[i];
    const p2 = locs[i + 1];

    // Filter out Noisy or Gapped Pings.
    const dtS = (p2.ts - p1.ts) / 1000;
    if (dtS < MIN_SAMPLE_DT_S || dtS > MAX_SAMPLE_DT_S) continue;

    // Filter out GPS Jumps implying Unrealistic Speed.
    const speedMps = haversineM(p1.lat, p1.lon, p2.lat, p2.lon) / dtS;
    if (speedMps > MAX_REALISTIC_SPEED_MPS) continue;

    const progressFraction = Math.min(1, Math.max(0, projectOntoPath(p1.lat, p1.lon, path) / path.totalLength));
    const { minuteOfDay, dayOfWeek } = localTimeParts(p1.ts);

    samples.push({
      route_id:          routeId,
      progress_fraction: progressFraction,
      minute_of_day:     minuteOfDay,
      day_of_week:       dayOfWeek,
      speed_mps:         speedMps,
    });
  }
  return samples;
}



// Forwards a Completed Trip's History to the Predictor Service.
export async function sendTrainingSamples(tripId: string, routeId: string): Promise<void> {
  try {
    const samples = await buildTrainingSamples(tripId, routeId);
    if (!samples.length) return;

    // Send Cleaned Samples to the Predictor Service for Model Training.
    const response = await fetch(`${PREDICTOR_SERVICE_URL}/model/train`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:     JSON.stringify({ samples }),
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