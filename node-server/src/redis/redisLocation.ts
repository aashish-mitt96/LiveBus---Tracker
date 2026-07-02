import { redisClient } from "./redisConnection";


const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;
const LOCATION_TTL_SECONDS = 7200; // Redis location history expiry (2 hours).
const MATCH_WINDOW_SIZE = 2;       // Recent GPS points used for Map Matching.


type RawPoint = { lat: number; lon: number; ts: number };


// Stores Recent Raw GPS Points for Each Trip.
const busRawWindow: Record<string, RawPoint[]> = {};


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

        const data = await response.json();
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



// Subscribe to Raw GPS updates & Process it.
export async function initRawLocationSubscriber() {

    const subscriber = redisClient.duplicate();
    await subscriber.connect();

    // Listen for Incoming GPS Data.
    await subscriber.subscribe("raw_location", async (message) => {
        const rawData = JSON.parse(message);
        const tripId  = rawData.tripId;

        if (!tripId) return; 
        const ts = rawData.timestamp ?? Date.now();

        // Maintain a Sliding Window of Recent GPS Points.
        if (!busRawWindow[tripId]) busRawWindow[tripId] = [];
        const window = busRawWindow[tripId];

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
    });

    return subscriber;
}