export const USE_DEMO = import.meta.env.VITE_USE_DEMO === 'true';

// Demo route: Gorakhpur (UP) -> Delhi.
// Format: [lat, lon, dwellPings]
//   dwellPings = 0  -> just a moving waypoint, advances to the next point on the next 10s tick.
//   dwellPings = N  -> the ticker sends N pings from this same point (bus "halted" here),
//                      then calls pinStop() once and moves on. Use this on real stops so you
//                      can verify stop-pinning + getStops() end-to-end.
//
// Coordinates are approximate city-centers along the Gorakhpur -> Basti -> Ayodhya ->
// Lucknow -> Kanpur -> Etawah -> Agra -> Mathura -> Faridabad -> Delhi corridor
// (roughly NH27 to Lucknow, then the Kanpur–Agra stretch of the Golden Quadrilateral,
// then NH19/Yamuna Expressway into Delhi), with a couple of interpolated waypoints on
// the longer legs so the marker moves smoothly on the map instead of jumping city to
// city. This is for testing the pipeline (search -> start trip -> live tracking ->
// Redis -> map matching -> stop pinning -> end trip), not for turn-by-turn accuracy.
export const DEMO_ROUTE: [number, number, number][] = [
  [26.760600, 83.373200, 0],   // Gorakhpur (origin - auto-pinned as source when tracking starts)

  [26.814800, 82.727400, 2],   // Basti (halt)

  [26.792200, 82.199800, 3],   // Ayodhya (halt)

  [26.846700, 80.946200, 3],   // Lucknow (halt)

  [26.449900, 80.331900, 2],   // Kanpur (halt)

  [26.617700, 79.673700, 0],   // near Bharthana (pass-through, no halt)

  [26.785500, 79.015400, 2],   // Etawah (halt)

  [26.981100, 78.511800, 0],   // near Bah (pass-through, no halt)

  [27.176700, 78.008100, 3],   // Agra (halt)

  [27.492400, 77.673700, 2],   // Mathura (halt)

  [28.408900, 77.317800, 2],   // Faridabad (halt)

  [28.613900, 77.209000, 3],   // Delhi (destination)
];