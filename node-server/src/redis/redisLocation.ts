import { eq } from "drizzle-orm";
import { db } from "../database/dbConnection";
import { trip } from "../database/schema/trip.schema";
import { redisClient } from "./redisConnection";


const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;
const LOCATION_TTL_SECONDS = 7200; // Redis location history expiry (2 hours).
const MATCH_WINDOW_SIZE = 2;       // Recent GPS points used for Map Matching.

// Same base URL Node already uses to forward training samples
// (training.service.ts) — the predictor service exposes /model/train and
// /predict on it.
const PREDICTOR_SERVICE_URL = process.env.PREDICTOR_SERVICE_URL || "http://localhost:8000";

// How long we wait without a raw_location ping before treating a trip as
// being in a GPS dead zone.
const DEAD_ZONE_TIMEOUT_MS = Number(process.env.DEAD_ZONE_TIMEOUT_MS) || 20_000;

// How often the watchdog re-checks tracked trips (and, while a trip stays
// in a dead zone, how often we re-query the predictor for a fresh estimate).
const WATCHDOG_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS) || 5_000;


type RawPoint = { lat: number; lon: number; ts: number };
type LastGoodState = { lat: number; lon: number; ts: number; velocity: number };

// Shape of the fields we actually read from the LocationIQ Map Matching response.
type MapMatchResponse = {
    tracepoints?: Array<{ location: [number, number] } | null> | null;
};

// Shape of the fields we actually read from the FastAPI predictor's /predict response.
type PredictorResponse = {
    lat: number;
    lon: number;
    velocity_mps: number;
    predicted_at: number;
    confidence_radius_m: number;
};


// Stores Recent Raw GPS Points for Each Trip.
const busRawWindow: Record<string, RawPoint[]> = {};

const tripLocks: Record<string, Promise<void>> = {};

// --- Dead-zone tracking state (in-memory, per trip) -------------------

// Last time we actually received a real raw_location ping for a trip.
const lastSeenAt: Record<string, number> = {};

// Last *real* GPS-derived location we trust — the anchor the predictor
// extrapolates forward from. Deliberately never overwritten by a
// prediction, so repeated predictor calls during a long dead zone keep
// measuring elapsed time from the last genuine fix, not from the previous
// guess (that's what lets the Kalman filter's uncertainty grow correctly).
const lastGoodState: Record<string, LastGoodState> = {};

// routeId rarely changes for a trip's lifetime — cache it instead of
// hitting Postgres on every watchdog tick.
const routeIdCache: Record<string, string> = {};

// Prevents overlapping predictor calls for the same trip if one is slow.
const predictInFlight: Record<string, boolean> = {};

let watchdogHandle: NodeJS.Timeout | null = null;


function runExclusive(tripId: string, task: () => Promise<void>): Promise<void> {
    const prev = tripLocks[tripId] ?? Promise.resolve();
    const next = prev
        .catch(() => {}) 
        .then(task);
    tripLocks[tripId] = next;
    return next;
}


async function getRouteId(tripId: string): Promise<string | null> {
    if (routeIdCache[tripId]) return routeIdCache[tripId];
    try {
        const [row] = await db.select().from(trip).where(eq(trip.tripId, tripId));
        if (!row) return null;
        routeIdCache[tripId] = row.routeId;
        return row.routeId;
    } catch (err) {
        console.error(`[dead_zone] failed to look up routeId for trip ${tripId}:`, err);
        return null;
    }
}


// Snap GPS Points to the Nearest Road using LocationIQ.
async function snapToRoad(window: RawPoint[]): Promise<{ lat: number; lon: number } | null> {

    if (window.length < 2) return null;
    try {
        // Format Coordinates for LocationIQ API.
        const coords = window.map(p => `${p.lon},${p.lat}`).join(";");
        const url    = `https://us1.locationiq.com/v1/matching/driving/${coords}`;

        const toSeconds  = (ts: number) => (ts > 1_000_000_000_000 ? Math.floor(ts / 1000) : ts);
        const timestamps = window.map(p => toSeconds(p.ts)).join(";");
        const radiuses   = window.map(() => "15").join(";");

        // Build Query Parameters for LocationIQ API Request.
        const params = new URLSearchParams({
            key: LOCATIONIQ_TOKEN || "",
            timestamps,
            radiuses,
            geometries: "geojson",
            annotations: "false",
            overview:    "false",
        });

        const response = await fetch(`${url}?${params.toString()}`);
        if (!response.ok) {
            console.error(`[map_match] HTTP error ${response.status}: ${await response.text()}`);
            return null;
        }

        const data = (await response.json()) as MapMatchResponse;
        const tracepoints = data.tracepoints || [];
        if (!tracepoints.length) return null;

        // Get the Snapped Location of the latest Point.
        const lastTp = tracepoints[tracepoints.length - 1];
        if (!lastTp) return null;

        const [snappedLon, snappedLat] = lastTp.location;
        return { lat: snappedLat, lon: snappedLon };

    } catch (err) {
        console.error("[map_match] Unexpected error:", err);
        return null;
    }
}


// Ask the FastAPI predictor for an extrapolated position and publish it
// exactly like a normal processed_data message, so Socket.IO clients and
// the cached lastLocation:{tripId} key don't need to know the difference.
async function requestPredictedLocation(tripId: string): Promise<void> {
    if (predictInFlight[tripId]) return;
    const anchor = lastGoodState[tripId];
    if (!anchor) return;

    const routeId = await getRouteId(tripId);
    if (!routeId) return;

    predictInFlight[tripId] = true;
    try {
        const response = await fetch(`${PREDICTOR_SERVICE_URL}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                trip_id: tripId,
                route_id: routeId,
                last_known: {
                    lat: anchor.lat,
                    lon: anchor.lon,
                    timestamp: anchor.ts,
                    velocity: anchor.velocity,
                },
                now: Date.now(),
            }),
        });

        if (!response.ok) {
            console.error(`[dead_zone] predictor HTTP error ${response.status}: ${await response.text()}`);
            return;
        }

        const predicted = (await response.json()) as PredictorResponse;

        const processedData = {
            tripId,
            lat: predicted.lat,
            lon: predicted.lon,
            velocity: predicted.velocity_mps,
            timestamp: predicted.predicted_at,
            map_matched: false,
            predicted: true,                                   // flags this as a dead-zone estimate, not real GPS
            confidence_radius_m: predicted.confidence_radius_m,
        };

        // NOTE: deliberately not pushed into trip:{tripId}:locs — that list
        // feeds model training, and training on the model's own guesses
        // would create a feedback loop. Only real GPS goes in there.
        await redisClient.publish("processed_data", JSON.stringify(processedData));
    } catch (err) {
        console.error(`[dead_zone] predictor request failed for trip ${tripId}:`, err);
    } finally {
        predictInFlight[tripId] = false;
    }
}


// Runs on an interval, checking every trip we're tracking for GPS silence.
function startDeadZoneWatchdog(): void {
    if (watchdogHandle) return;
    watchdogHandle = setInterval(() => {
        const now = Date.now();
        for (const tripId of Object.keys(lastSeenAt)) {
            if (now - lastSeenAt[tripId] >= DEAD_ZONE_TIMEOUT_MS) {
                requestPredictedLocation(tripId).catch(err =>
                    console.error(`[dead_zone] unhandled error predicting for trip ${tripId}:`, err)
                );
            }
        }
    }, WATCHDOG_INTERVAL_MS);
}


// Clear in-memory window state for a trip (call this when a trip ends).
export function clearTripWindow(tripId: string): void {
    delete busRawWindow[tripId];
    delete tripLocks[tripId];
    delete lastSeenAt[tripId];
    delete lastGoodState[tripId];
    delete routeIdCache[tripId];
    delete predictInFlight[tripId];
}



// Subscribe to Raw GPS updates & Process it.
export async function initRawLocationSubscriber() {

    const subscriber = redisClient.duplicate();
    await subscriber.connect();

    startDeadZoneWatchdog();

    // Listen for Incoming GPS Data.
    await subscriber.subscribe("raw_location", (message) => {
        (async () => {
            let tripId: string | undefined;
            try {
                const rawData = JSON.parse(message);
                tripId = rawData.tripId;
                if (!tripId) return;
                const ts = rawData.timestamp ?? Date.now();

                await runExclusive(tripId, async () => {
                    try {
                        // Maintain a Sliding Window of Recent GPS Points.
                        if (!busRawWindow[tripId!]) busRawWindow[tripId!] = [];
                        const window = busRawWindow[tripId!];

                        window.push({ lat: rawData.lat, lon: rawData.lon, ts });
                        if (window.length > MATCH_WINDOW_SIZE) window.shift();

                        // Snap the Latest Point to the Road.
                        const snapped = await snapToRoad(window);

                        let lat: number, lon: number, mapMatched: boolean;

                        if (snapped) {
                            lat = snapped.lat;
                            lon = snapped.lon;
                            mapMatched = true;
                        } else {
                            // Use Raw GPS if Map Matching Fails.
                            lat = rawData.lat;
                            lon = rawData.lon;
                            mapMatched = false;
                        }

                        // Create Processed Location Payload.
                        const processedData = {
                            tripId,
                            lat,
                            lon,
                            velocity:    rawData.vel ?? 0,
                            timestamp:   ts,
                            map_matched: mapMatched,
                        };

                        // Store Latest Location History in Redis.
                        const key = `trip:${tripId}:locs`;
                        await redisClient.rPush(key, JSON.stringify({ lat, lon, ts }));
                        await redisClient.expire(key, LOCATION_TTL_SECONDS);

                        // Publish Processed Location for Downstream Services.
                        await redisClient.publish("processed_data", JSON.stringify(processedData));

                        // Real GPS arrived — reset dead-zone tracking so the
                        // watchdog stops treating this trip as silent, and
                        // anchor the next possible prediction to this fix.
                        lastSeenAt[tripId!] = Date.now();
                        lastGoodState[tripId!] = { lat, lon, ts, velocity: rawData.vel ?? 0 };
                    } catch (innerErr) {
                        console.error(`[raw_location] failed to process message for trip ${tripId}:`, innerErr);
                    }
                });
            } catch (err) {
                console.error("[raw_location] malformed message, skipping:", err);
            }
        })();
    });

    return subscriber;
}