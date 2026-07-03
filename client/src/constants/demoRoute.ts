export const USE_DEMO = import.meta.env.VITE_USE_DEMO === 'true';

// Demo route: Deoria (UP) -> Bhubaneswar (Odisha).
// Format: [lat, lon, dwellPings]
//   dwellPings = 0  -> just a moving waypoint, advances to the next point on the next 10s tick.
//   dwellPings = N  -> the ticker sends N pings from this same point (bus "halted" here),
//                      then calls pinStop() once and moves on. Use this on real stops so you
//                      can verify stop-pinning + getStops() end-to-end.
//
// Coordinates are approximate city-centers along the Deoria -> Gorakhpur -> Varanasi ->
// Sasaram -> Aurangabad(BH) -> Ranchi -> Rourkela -> Angul -> Cuttack -> Bhubaneswar
// corridor, with a couple of interpolated waypoints between each pair so the marker moves
// smoothly on the map instead of jumping city to city. This is for testing the pipeline
// (search -> start trip -> live tracking -> Redis -> map matching -> stop pinning -> end trip),
// not for turn-by-turn accuracy.
export const DEMO_ROUTE: [number, number, number][] = [
  [26.502400, 83.779100, 0],   // Deoria (origin - auto-pinned as source when tracking starts)
  [26.588467, 83.643800, 0],
  [26.674533, 83.508500, 0],
  [26.760600, 83.373200, 2],   // Gorakhpur (halt)

  [26.279600, 83.240100, 0],
  [25.798600, 83.107000, 0],
  [25.317600, 82.973900, 3],   // Varanasi (halt)

  [25.195567, 83.322367, 0],
  [25.073533, 83.670833, 0],
  [24.951500, 84.019300, 0],   // Sasaram (pass-through, no halt)

  [24.885067, 84.137600, 0],
  [24.818633, 84.255900, 0],
  [24.752200, 84.374200, 2],   // Aurangabad, Bihar (halt)

  [24.282833, 84.686000, 0],
  [23.813467, 84.997800, 0],
  [23.344100, 85.309600, 3],   // Ranchi (halt)

  [22.982867, 85.157600, 0],
  [22.621633, 85.005600, 0],
  [22.260400, 84.853600, 2],   // Rourkela (halt)

  [21.786933, 84.935733, 0],
  [21.313467, 85.017867, 0],
  [20.840000, 85.100000, 0],   // Angul (pass-through, no halt)

  [20.714167, 85.360933, 0],
  [20.588333, 85.621867, 0],
  [20.462500, 85.882800, 2],   // Cuttack (halt)

  [20.407033, 85.863367, 0],
  [20.351567, 85.843933, 0],
  [20.296100, 85.824500, 3],   // Bhubaneswar (destination)
];