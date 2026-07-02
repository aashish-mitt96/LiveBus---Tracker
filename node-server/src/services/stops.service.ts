import { eq } from "drizzle-orm";
import { db } from "../database/dbConnection";
import { addStopToRoute } from "./route.service";
import { trip } from "../database/schema/trip.schema";
import { redisClient } from "../redis/redisConnection";


const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;



// Reverse Geocode Coordinates to get Readable Place Name.
export async function getPlaceName(lat: number, lng: number): Promise<string> {

  const url = `https://us1.locationiq.com/v1/reverse?key=${LOCATIONIQ_TOKEN}&lat=${lat}&lon=${lng}&format=json`;
  try {
    const response = await fetch(url);
    const data     = await response.json();
    const addr     = data.address || {};

    // Return the most Specific Available Location Name.
    return (
      addr.amenity        ||
      addr.road           ||
      addr.neighbourhood  ||
      addr.suburb         ||
      addr.village        ||
      addr.town           ||
      addr.city           ||
      addr.county         ||
      addr.state_district ||
      addr.state          ||
      "Unknown"
    );
  } catch (err) {
    console.error("[locationiq] exception:", err);
    return "Unknown";
  }
}



// Store Detected Stop Temporarily in Redis.
export async function bufferStop( tripId: string, lat: number, lng: number ): Promise<string> {

  const name     = await getPlaceName(lat, lng);
  const redisKey = `trip:${tripId}:pending_stops`;

  // Append Stop to Trip Specific Buffer.
  await redisClient.rPush( redisKey, JSON.stringify({ lat, lng, stop_name: name }));

  // Auto-expire buffer after 24 hours.
  await redisClient.expire(redisKey, 86400);

  return name;
}



// Move Buffered Stops from Redis into the Route Permanently.
export async function flushStopsToRoute(tripId: string): Promise<boolean> {

  const redisKey = `trip:${tripId}:pending_stops`;

  // Get all Buffered Stops.
  const rawStops = await redisClient.lRange(redisKey, 0, -1);
  if (!rawStops.length) return true;

  // Fetch Trip to Obtain its routeId
  const [existingTrip] = await db.select().from(trip).where(eq(trip.tripId, tripId));
  if (!existingTrip) {
    console.error(`[flush_stops] trip ${tripId} not found, dropping buffer`);
    await redisClient.del(redisKey);
    return false;
  }
  let allOk = true;

  // Save Each Buffered Stop into the Route.
  for (const raw of rawStops) {
    try {
      const stop   = JSON.parse(raw);
      const result = await addStopToRoute(existingTrip.routeId, stop);

    } catch (err) {
      allOk = false;
    }
  }

  // Clear Buffer after Processing.
  await redisClient.del(redisKey);
  return allOk;
}