// Great Circle Distance between two lat/lon Points.
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {

  const R     = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}



// Convert lat/lon to Meters Relative to an Origin Point.
export function toLocalMeters(lat: number, lon: number, originLat: number, originLon: number) {

  const metersPerDegLon = 111_320.0 * Math.cos((originLat * Math.PI) / 180);
  return { x: (lon - originLon) * metersPerDegLon, y: (lat - originLat) * 111_320.0 };
}