import { asc, eq } from "drizzle-orm";
import { db } from "../database/dbConnection";

import { haversineM, toLocalMeters } from "./math.utils";
import { routeStop } from "../database/schema/route.schema";

export type PathPoint = { lat: number; lng: number };

export type RoutePath = {
  points:      PathPoint[];
  cumDist:     number[];
  totalLength: number;
};


// Build a RoutePath (with precomputed cumulative distances) from an ordered list of points.
export function buildRoutePath(points: PathPoint[]): RoutePath {
  const cumDist = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cumDist.push(cumDist[cumDist.length - 1] + haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng));
  }
  return { points, cumDist, totalLength: cumDist[cumDist.length - 1] };
}


// Fetch a route's stops in travel order and build its RoutePath.
export async function buildRoutePolyline(routeId: string): Promise<RoutePath | null> {

  const stops = await db.select().from(routeStop)
    .where(eq(routeStop.routeId, routeId))
    .orderBy(asc(routeStop.seq));

  if (stops.length < 2) return null;

  return buildRoutePath(stops.map((s) => ({ lat: s.lat, lng: s.lng })));
}


// Project a lat/lon onto the nearest segment of the path to get distance along the route.
export function projectOntoPath(lat: number, lng: number, path: RoutePath): number {
  let bestS    = 0;
  let bestDist = Infinity;

  for (let i = 0; i < path.points.length - 1; i++) {
    const A = path.points[i];
    const B = path.points[i + 1];

    const { x: bx, y: by } = toLocalMeters(B.lat, B.lng, A.lat, A.lng);
    const { x: px, y: py } = toLocalMeters(lat, lng, A.lat, A.lng);

    const segLenSq = bx * bx + by * by;
    let t = segLenSq === 0 ? 0 : (px * bx + py * by) / segLenSq;
    t = Math.max(0, Math.min(1, t));

    const dist    = Math.hypot(px - t * bx, py - t * by);
    const segLenM = path.cumDist[i + 1] - path.cumDist[i];
    const s       = path.cumDist[i] + t * segLenM;

    if (dist < bestDist) {
      bestDist = dist;
      bestS = s;
    }
  }
  return bestS;
}