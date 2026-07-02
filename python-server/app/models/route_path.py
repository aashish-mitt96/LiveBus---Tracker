from math import radians, sin, cos, sqrt, atan2

EARTH_RADIUS_M     = 6371000.0
METERS_PER_DEG_LAT = 111_320.0


# Calculate the Distance Between two GPS Coordinates (in meters).
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1r, lon1r, lat2r, lon2r = map(radians, (lat1, lon1, lat2, lon2))
    dlat = lat2r - lat1r
    dlon = lon2r - lon1r
    a = sin(dlat / 2) ** 2 + cos(lat1r) * cos(lat2r) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * atan2(sqrt(a), sqrt(1 - a))


# Convert latitude/longitude to local Cartesian Coordinates.
def _to_local_meters(lat: float, lon: float, origin_lat: float, origin_lon: float):
    meters_per_deg_lon = METERS_PER_DEG_LAT * cos(radians(origin_lat))
    x = (lon - origin_lon) * meters_per_deg_lon
    y = (lat - origin_lat) * METERS_PER_DEG_LAT
    return x, y



class RoutePath:
    """Represents a Bus Route as an Ordered Sequence of GPS Points."""

    # Build the Route and Precompute Cumulative Distances.
    def __init__(self, points: list[tuple[float, float]]):
        if len(points) < 2:
            raise ValueError("RoutePath needs at least 2 points")

        self.points = [(float(a), float(b)) for a, b in points]

        # Compute Length of Each Route Segment.
        seg_lengths = [
            haversine_m(*self.points[i], *self.points[i + 1])
            for i in range(len(self.points) - 1)
        ]

        # Compute Cumulative Distance along the Route.
        self.cum_dist = [0.0]
        for length in seg_lengths:
            self.cum_dist.append(self.cum_dist[-1] + length)

        self.total_length = self.cum_dist[-1]


    # Project a GPS point onto the Route.
    def project(self, lat: float, lon: float) -> tuple[float, float]:
        best_s = 0.0
        best_dist = float("inf")

        # Check every Route Segment.
        for i in range(len(self.points) - 1):
            a_lat, a_lon = self.points[i]
            b_lat, b_lon = self.points[i + 1]

            bx, by = _to_local_meters(b_lat, b_lon, a_lat, a_lon)
            px, py = _to_local_meters(lat, lon, a_lat, a_lon)

            seg_len_sq = bx ** 2 + by ** 2

            # Find the Closest Point on the Segment.
            if seg_len_sq == 0:
                t = 0.0
            else:
                t = (px * bx + py * by) / seg_len_sq
                t = max(0.0, min(1.0, t))

            proj_x, proj_y = t * bx, t * by
            dist = sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)

            # Distance travelled along the Route.
            seg_len_m = self.cum_dist[i + 1] - self.cum_dist[i]
            s = self.cum_dist[i] + t * seg_len_m

            if dist < best_dist:
                best_dist = dist
                best_s = s

        return best_s, best_dist


    # Convert Route Distance back to GPS Coordinates.
    def point_at_distance(self, s: float) -> tuple[float, float]:
        s = max(0.0, min(s, self.total_length))

        # Find the segment containing the distance.
        idx = len(self.points) - 2
        for i in range(len(self.cum_dist) - 1):
            if self.cum_dist[i] <= s <= self.cum_dist[i + 1]:
                idx = i
                break

        seg_len = self.cum_dist[idx + 1] - self.cum_dist[idx]
        t = 0.0 if seg_len == 0 else (s - self.cum_dist[idx]) / seg_len

        # Interpolate the GPS coordinates.
        a_lat, a_lon = self.points[idx]
        b_lat, b_lon = self.points[idx + 1]

        lat = a_lat + t * (b_lat - a_lat)
        lon = a_lon + t * (b_lon - a_lon)

        return lat, lon