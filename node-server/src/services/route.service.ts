import { db } from "../database/dbConnection";
import { and, asc, desc, eq } from "drizzle-orm";
import { route, routeStop } from "../database/schema/route.schema";


type NewStop = { 
  lat:       number; 
  lng:       number; 
  stop_name: string; 
};


type AddStopResult = {
  skipped: boolean;
  merged:  boolean;         
  stops:  (typeof routeStop.$inferSelect)[];
};


const MIN_STOP_DISTANCE_METERS = 75; 
const MIN_SEQ_GAP = 1e-6;


// Calculate Distance between two Coordinates (Haversine Formula).
function distanceInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}



// Update Stop Coordinates using Running Average.
async function mergeIntoStop(
  stop: typeof routeStop.$inferSelect,
  lat: number,
  lng: number,
  markResolved = false,
) {

  const n = stop.sampleCount;
  const newLat = n === 0 ? lat : (stop.lat * n + lat) / (n + 1);
  const newLng = n === 0 ? lng : (stop.lng * n + lng) / (n + 1);

  const [updated] = await db.update(routeStop).set({
      lat: newLat,
      lng: newLng,
      sampleCount: n + 1,
      ...(markResolved ? { resolved: true } : {}),
    })
    .where(eq(routeStop.id, stop.id))
    .returning();
  return updated;
}



// Find the Best Edge to Insert a New Stop Into.
function findInsertionSeq(stops: (typeof routeStop.$inferSelect)[], newStop: NewStop): number {

  let bestCost = Infinity;
  let bestSeq  = stops[stops.length - 1].seq + 1; 

  for (let i = 0; i < stops.length - 1; i++) {
    const A = stops[i];
    const B = stops[i + 1];

    const cost =
      distanceInMeters(A.lat, A.lng, newStop.lat, newStop.lng) +
      distanceInMeters(newStop.lat, newStop.lng, B.lat, B.lng) -
      distanceInMeters(A.lat, A.lng, B.lat, B.lng);

    if (cost < bestCost) {
      bestCost = cost;
      bestSeq = (A.seq + B.seq) / 2;
    }
  }
  return bestSeq;
}


// Renumber every stop on a route to clean integer seq values (0,1,2,...).
async function renumberRoute(routeId: string): Promise<(typeof routeStop.$inferSelect)[]> {
  const stops = await db.select().from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  await db.transaction(async (tx) => {
    for (let i = 0; i < stops.length; i++) {
      await tx.update(routeStop).set({ seq: i }).where(eq(routeStop.id, stops[i].id));
    }
  });

  return db.select().from(routeStop).where(eq(routeStop.routeId, routeId)).orderBy(asc(routeStop.seq));
}


// Add a Stop to an Existing Route.
export async function addStopToRoute(routeId: string, newStop: NewStop): Promise<AddStopResult> {

  const stops = await db.select().from(routeStop).where(eq(routeStop.routeId, routeId)).orderBy(asc(routeStop.seq));
  if (stops.length < 2) {
    throw new Error("Route has no seeded source/destination stops.");
  }

  // Find the Nearest Existing Stop.
  let nearest     = stops[0];
  let nearestDist = Infinity;

  for (const s of stops) {
    const d = distanceInMeters(s.lat, s.lng, newStop.lat, newStop.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = s;
    }
  }

  // Merge if the Stop already Exists Nearby.
  if (nearestDist < MIN_STOP_DISTANCE_METERS) {
    const merged = await mergeIntoStop(nearest, newStop.lat, newStop.lng);
    const finalStops = stops.map((s) => (s.id === merged.id ? merged : s));
    return { skipped: true, merged: true, stops: finalStops };
  }

  // Find the Best Insertion Position (midpoint seq — no shifting needed).
  let insertSeq = findInsertionSeq(stops, newStop);

  const collides = stops.some((s) => Math.abs(s.seq - insertSeq) < MIN_SEQ_GAP);
  if (collides) {
    const renumbered = await renumberRoute(routeId);
    insertSeq = findInsertionSeq(renumbered, newStop);
  }

  // Single insert, no other rows touched — nothing to race on.
  await db.insert(routeStop).values({
    routeId,
    seq:         insertSeq,
    stopName:    newStop.stop_name,
    lat:         newStop.lat,
    lng:         newStop.lng,
    isTerminal:  false,
    sampleCount: 1,
  });

  const updated = await db.select().from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  return { skipped: false, merged: false, stops: updated };
}



// Refine Destination Coordinates using a Running Average.
export async function refineDestinationCoords(routeId: string, lat: number, lng: number) {

  const [destStop] = await db.select().from(routeStop).where(eq(routeStop.routeId, routeId))
    .orderBy(desc(routeStop.seq))
    .limit(1);
  if (!destStop) return;

  if (!destStop.resolved) {
    await db.update(routeStop)
      .set({ lat, lng, sampleCount: 1, resolved: true })
      .where(eq(routeStop.id, destStop.id));
    return;
  }

  await mergeIntoStop(destStop, lat, lng, true);
}



// Find an Existing Route or Create a New One.
export async function findOrCreateRoute(bus_number: string, source: string, destination: string) {

  const [existing] = await db.select().from(route)
    .where(
      and(
        eq(route.bus_number, bus_number),
        eq(route.source, source),
        eq(route.destination, destination)
      )
    );
  if (existing) {
    return { routeRow: existing, isNew: false };
  }

  try {
    const [created] = await db.insert(route)
      .values({ bus_number, source, destination })
      .returning();
    return { routeRow: created, isNew: true };

  } catch (err: any) {
    if (err.code === "23505") {
      const [race] = await db.select().from(route)
        .where(
          and(
            eq(route.bus_number, bus_number),
            eq(route.source, source),
            eq(route.destination, destination)
          )
        );
      if (race) return { routeRow: race, isNew: false };
    }
    throw err;
  }
}