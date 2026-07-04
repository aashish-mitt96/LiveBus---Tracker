"""
Route-as-a-path geometry helpers. Deliberately mirrors the logic already
used on the Node side (geo.service.ts / route.service.ts) so distances and
projections computed here agree with what Node computes for ETA — we don't
want the two services disagreeing about where "500m along the route" is.
"""
import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

EARTH_RADIUS_M = 6371000.0
METERS_PER_DEG_LAT = 111_320.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _to_local_meters(lat: float, lng: float, origin_lat: float, origin_lng: float) -> Tuple[float, float]:
    meters_per_deg_lng = METERS_PER_DEG_LAT * math.cos(math.radians(origin_lat))
    x = (lng - origin_lng) * meters_per_deg_lng
    y = (lat - origin_lat) * METERS_PER_DEG_LAT
    return x, y


@dataclass
class RouteStopPoint:
    id: str
    seq: float
    stop_name: str
    lat: float
    lng: float


@dataclass
class RoutePath:
    stops: List[RouteStopPoint]
    cum_dist: List[float]     # cumulative meters up to each stop, len == len(stops)
    total_length: float       # meters


def build_route_path(stops: List[RouteStopPoint]) -> RoutePath:
    cum_dist = [0.0]
    for i in range(len(stops) - 1):
        cum_dist.append(
            cum_dist[-1] + haversine_m(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng)
        )
    return RoutePath(stops=stops, cum_dist=cum_dist, total_length=cum_dist[-1] if cum_dist else 0.0)


def project_onto_path(lat: float, lng: float, path: RoutePath) -> float:
    """Distance (m) along the path of the closest point to (lat, lng)."""
    best_s = 0.0
    best_dist = math.inf

    for i in range(len(path.stops) - 1):
        a, b = path.stops[i], path.stops[i + 1]
        bx, by = _to_local_meters(b.lat, b.lng, a.lat, a.lng)
        px, py = _to_local_meters(lat, lng, a.lat, a.lng)

        seg_len_sq = bx * bx + by * by
        t = 0.0 if seg_len_sq == 0 else (px * bx + py * by) / seg_len_sq
        t = max(0.0, min(1.0, t))

        dist = math.hypot(px - t * bx, py - t * by)
        seg_len_m = path.cum_dist[i + 1] - path.cum_dist[i]
        s = path.cum_dist[i] + t * seg_len_m

        if dist < best_dist:
            best_dist = dist
            best_s = s
    return best_s


def interpolate_at_distance(path: RoutePath, s: float) -> Tuple[float, float]:
    """Given distance-along-route s (meters), return the interpolated (lat, lng)."""
    if not path.stops:
        return 0.0, 0.0
    s = max(0.0, min(path.total_length, s))

    for i in range(len(path.stops) - 1):
        seg_start, seg_end = path.cum_dist[i], path.cum_dist[i + 1]
        if s <= seg_end or i == len(path.stops) - 2:
            seg_len = seg_end - seg_start
            t = 0.0 if seg_len == 0 else (s - seg_start) / seg_len
            t = max(0.0, min(1.0, t))
            a, b = path.stops[i], path.stops[i + 1]
            return (a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t)

    last = path.stops[-1]
    return last.lat, last.lng


def find_segment_index(path: RoutePath, s: float) -> int:
    """Index i such that s falls between stop i and stop i+1 (clamped)."""
    for i in range(len(path.cum_dist) - 1):
        if s <= path.cum_dist[i + 1]:
            return i
    return max(0, len(path.cum_dist) - 2)


def progress_fraction(path: RoutePath, s: float) -> float:
    if path.total_length <= 0:
        return 0.0
    return max(0.0, min(1.0, s / path.total_length))