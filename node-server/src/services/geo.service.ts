// Small, dependency-free geometry helpers shared by services that need to
// reason about a route as a path (ETA calculation, map-matching, training).

export type PathPoint = { lat: number; lng: number };

export type RoutePath = {
  points:      PathPoint[];
  cumDist:     number[]; // cumulative distance (meters) up to each point, cumDist.length === points.length
  totalLength: number;   // meters
};


// Calculate Distance between two Coordinates (Haversine Formula).
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
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


// Convert latitude/longitude to local Cartesian Coordinates (meters), relative to an origin.
function toLocalMeters(lat: number, lng: number, originLat: number, originLng: number) {
  const METERS_PER_DEG_LAT = 111_320.0;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return { x: (lng - originLng) * metersPerDegLng, y: (lat - originLat) * METERS_PER_DEG_LAT };
}


// Build a RoutePath (with precomputed cumulative distances) from an ordered list of points.
export function buildRoutePath(points: PathPoint[]): RoutePath {
  const cumDist = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cumDist.push(cumDist[cumDist.length - 1] + haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng));
  }
  return { points, cumDist, totalLength: cumDist[cumDist.length - 1] };
}


// Project a GPS point onto the route path, returning the distance travelled
// along the path (in meters) up to the closest point on the path.
export function projectOntoPath(lat: number, lng: number, path: RoutePath): number {
  let bestS = 0;
  let bestDist = Infinity;

  for (let i = 0; i < path.points.length - 1; i++) {
    const A = path.points[i];
    const B = path.points[i + 1];

    const { x: bx, y: by } = toLocalMeters(B.lat, B.lng, A.lat, A.lng);
    const { x: px, y: py } = toLocalMeters(lat, lng, A.lat, A.lng);

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