import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import L from "leaflet";
import type { Map, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import { io, Socket } from "socket.io-client";
import { getStops, getEta } from "../apis/trip.api";
import '../styles/Map.css';

// ── types ─────────────────────────────────────────────────────────────────────

type LatLng = [number, number];
type Stop = { lat: number; lng: number; stop_name: string; seq: number };

type StopEta = {
  seq:                number;
  stopName:           string;
  distanceRemainingM: number | null;
  etaSeconds:         number | null;
  etaMinutes:         number | null;
  etaTimestamp:       number | null;
  passed:             boolean;
};

type BoardAlight = { board?: string; alight?: string };

type Status = "idle" | "connecting" | "riding" | "waiting" | "stopped" | "last_known";

interface LocationUpdate {
  tripId: string;
  lat: number;
  lon: number;
  vel?: number | null;
  acc?: number | null;
  timestamp: number;
}

// ── constants ─────────────────────────────────────────────────────────────────

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;

// How long each queued segment takes to animate is derived from the real
// gap between that update's `timestamp` and the previous one's — normal GPS
// pings arrive ~10s apart, but dead-zone predictions from the backend's
// watchdog arrive every ~5s (see node-server WATCHDOG_INTERVAL_MS). If we
// always animated over a fixed 10s, updates would arrive faster than we can
// play them back during a dead zone and the on-screen bus would drift
// further and further behind real time the longer the dead zone lasted.
// Falling back to DEFAULT_ANIM_MS when we don't have two timestamps to
// compare yet (first update) or the gap looks bogus (clock skew, out-of-
// order delivery) keeps behaviour identical to before in the common case.
const DEFAULT_ANIM_MS = 10_000;
const MIN_ANIM_MS = 2_000;
const MAX_ANIM_MS = 12_000;

const STATUS_LABELS: Record<Status, string> = {
  idle: "Waiting for connection…",
  connecting: "Connecting…",
  riding: "Animating…",
  waiting: "Waiting for next location…",
  stopped: "Bus stopped",
  last_known: "Showing last known location",
};

// ── pure helpers ──────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

function buildCumulativeDist(coords: LatLng[]): number[] {
  const cd: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const dlat = coords[i][0] - coords[i - 1][0];
    const dlng = coords[i][1] - coords[i - 1][1];
    cd.push(cd[cd.length - 1] + Math.sqrt(dlat * dlat + dlng * dlng));
  }
  return cd;
}

function getPositionAt(t: number, points: LatLng[], cumulDist: number[]): LatLng {
  const total = cumulDist[cumulDist.length - 1];
  const target = t * total;
  let lo = 0, hi = cumulDist.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulDist[mid + 1] < target) lo = mid + 1;
    else hi = mid;
  }
  const seg = cumulDist[lo + 1] - cumulDist[lo];
  const segT = seg === 0 ? 0 : (target - cumulDist[lo]) / seg;
  return [
    lerp(points[lo][0], points[lo + 1][0], segT),
    lerp(points[lo][1], points[lo + 1][1], segT),
  ];
}

function bearing(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(to[1] - from[1]);
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Sort a stop list by its `seq` (double precision) field, ascending. */
function sortBySeq(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

// ── bus marker icon (Google Maps style — blue live-location puck) ─────────────

function makeBusIcon(opacity = 1) {
  return L.divIcon({
    className: "",
    html: `
      <div class="smt-bike-icon" style="opacity:${opacity};width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
        <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="18" fill="rgba(26,115,232,0.15)" stroke="#1a73e8" stroke-width="1.5"/>
          <polygon
            points="20,6 30,30 20,25 10,30"
            fill="#1a73e8"
            stroke="#ffffff"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <circle cx="20" cy="20" r="2.5" fill="#ffffff"/>
        </svg>
      </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

// ── stop marker icons (regular / source / destination) ────────────────────────

function makeStopIcon(kind: "source" | "destination" | "mid", label: number) {
  if (kind === "source") {
    return L.divIcon({
      className: "",
      html: `
        <div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(60,64,67,0.3));">
          <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 0C6.72 0 0 6.72 0 15c0 11.25 15 25 15 25s15-13.75 15-25C30 6.72 23.28 0 15 0z" fill="#34a853"/>
            <circle cx="15" cy="15" r="10.5" fill="#ffffff"/>
            <path d="M10 15.5l3.2 3.2L20.5 11" stroke="#34a853" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>`,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    });
  }
  if (kind === "destination") {
    return L.divIcon({
      className: "",
      html: `
        <div style="filter:drop-shadow(0 2px 4px rgba(60,64,67,0.3));">
          <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 0C6.72 0 0 6.72 0 15c0 11.25 15 25 15 25s15-13.75 15-25C30 6.72 23.28 0 15 0z" fill="#ea4335"/>
            <circle cx="15" cy="15" r="10.5" fill="#ffffff"/>
            <g transform="translate(9.5,9)">
              <rect width="1.6" height="12.5" fill="#ea4335"/>
              <path d="M1.6 0h9l-2.2 2.6 2.2 2.6h-9z" fill="#ea4335"/>
            </g>
          </svg>
        </div>`,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    });
  }
  return L.divIcon({
    className: "",
    html: `
      <div style="filter:drop-shadow(0 1px 3px rgba(60,64,67,0.25));">
        <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="11" fill="#1a73e8" stroke="#ffffff" stroke-width="2"/>
          <text x="12" y="16" text-anchor="middle" font-family="DM Mono, monospace" font-size="10" font-weight="600" fill="#ffffff">${label}</text>
        </svg>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export default function BusTracker() {
  const { tripId } = useParams<{ tripId: string }>();

  // ── map refs ────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const routeLayerRef = useRef<Polyline | null>(null);
  const stopMarkersRef = useRef<Marker[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const currentPosRef = useRef<LatLng | null>(null);
  const routePointsRef = useRef<LatLng[]>([]);
  const cumulDistRef = useRef<number[]>([]);
  const joinedRoomRef = useRef<string | null>(null);

  // ── queue refs ──────────────────────────────────────────────────────────
  const updateQueueRef = useRef<LocationUpdate[]>([]);
  const lastAnimStartRef = useRef<number>(0);
  const schedulerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `timestamp` (server-side event time) of the last update we actually
  // displayed — used to measure the real gap to the next update, which may
  // not be 10s (see DEFAULT_ANIM_MS comment above).
  const lastUpdateTimestampRef = useRef<number | null>(null);
  // Duration used to animate/pace the segment currently in flight; scheduleNext
  // paces the *next* dequeue against this rather than a fixed SLOT_MS.
  const lastSegmentDurationRef = useRef<number>(DEFAULT_ANIM_MS);

  // ── ui state ────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>("idle");
  const [stops, setStops] = useState<Stop[]>([]);
  const [etaMap, setEtaMap] = useState<Record<number, StopEta>>({});
  const [boardAlight, setBoardAlight] = useState<BoardAlight>({});
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("smtTheme") as "light" | "dark") || "light";
  });

  // ── load the board/alight stops the user picked on the search page ────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("trackBoardAlight");
      if (raw) setBoardAlight(JSON.parse(raw));
    } catch {
      // ignore malformed/absent cache
    }
  }, []);

  // ── poll ETA for every stop (Where-is-my-train style) ──────────────────────
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;

    const fetchEta = async () => {
      try {
        const res = await getEta(tripId);
        if (cancelled) return;
        const map: Record<number, StopEta> = {};
        (res.stops || []).forEach((s: StopEta) => { map[s.seq] = s; });
        setEtaMap(map);
      } catch (err) {
        console.error("Failed to fetch ETA:", err);
      }
    };

    fetchEta();
    const interval = setInterval(fetchEta, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tripId]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("smtTheme", next);
      return next;
    });
  }, []);

  // ── render stop markers on the map (pure — no fetching here) ─────────────
  // `stopList` must already be sorted by `seq` before being passed in.
  const renderStops = useCallback((stopList: Stop[]) => {
    const map = mapRef.current;
    if (!map) return;

    stopMarkersRef.current.forEach((m) => map.removeLayer(m));
    stopMarkersRef.current = [];

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (!stopList.length) return;

    setStops(stopList);

    const latLngs: LatLng[] = stopList.map((s) => [s.lat, s.lng]);
    const lastIdx = stopList.length - 1;

    stopList.forEach((stop, i) => {
      const kind: "source" | "destination" | "mid" =
        i === 0 ? "source" : i === lastIdx ? "destination" : "mid";
      const icon = makeStopIcon(kind, i + 1);

      const marker = L.marker([stop.lat, stop.lng], { icon })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:'DM Mono',monospace; min-width:170px; background:#ffffff; border:1px solid #dadce0; border-radius:10px; padding:10px 14px; box-shadow:0 2px 8px rgba(60,64,67,0.2);">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <div style="width:20px; height:20px; border-radius:50%; background:${kind === "source" ? "#34a853" : kind === "destination" ? "#ea4335" : "#1a73e8"}; color:#fff; font-size:11px; font-weight:600; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${i + 1}
          </div>
          <span style="color:#202124; font-size:13px; font-weight:600; letter-spacing:0.02em;">
            ${kind === "source" ? "Source" : kind === "destination" ? "Destination" : `Stop ${i + 1}`}
          </span>
        </div>
        <div style="color:#5f6368; font-size:11px; padding-left:28px; line-height:1.4;">
          ${stop.stop_name}
        </div>
      </div>`,
          { className: 'light-popup', closeButton: false, offset: [0, -8] }
        );
      stopMarkersRef.current.push(marker);
    });

    map.fitBounds(latLngs as L.LatLngBoundsExpression, { padding: [40, 40] });
  }, []);

  // ── load route stops: fetch from the server first (source of truth) ──────
  const loadRouteStops = useCallback(async () => {
    if (tripId) {
      try {
        const res = await getStops(tripId);
        const stopList: Stop[] = sortBySeq(
          (res.stops || [])
            .map((entry: any) => ({
              lat:       entry.stop.lat,
              lng:       entry.stop.lng,
              stop_name: entry.stop.stopName,
              seq:       entry.stop.seq,
            }))
            .filter((s: Stop) => s.lat != null && s.lng != null)
        );

        localStorage.setItem("trackRoute", JSON.stringify(stopList));
        renderStops(stopList);
        return;
      } catch (err) {
        console.error("Failed to fetch stops from server, falling back to cached route:", err);
      }
    }

    const raw = localStorage.getItem("trackRoute");
    if (!raw) return;

    let stopList: Stop[] = [];
    try {
      stopList = sortBySeq(
        (JSON.parse(raw) as (Stop | null)[]).filter(
          (s): s is Stop => s !== null && s.lat != null && s.lng != null
        )
      );
    } catch {
      return;
    }

    renderStops(stopList);
  }, [tripId, renderStops]);

  // ── reset map state ──────────────────────────────────────────────────────
  const resetMapState = useCallback(() => {
    const map = mapRef.current;

    if (routeLayerRef.current && map) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
    if (markerRef.current && map) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    updateQueueRef.current = [];
    if (schedulerRef.current !== null) {
      clearTimeout(schedulerRef.current);
      schedulerRef.current = null;
    }
    lastAnimStartRef.current = 0;
    lastUpdateTimestampRef.current = null;
    lastSegmentDurationRef.current = DEFAULT_ANIM_MS;

    currentPosRef.current = null;
    routePointsRef.current = [];
    cumulDistRef.current = [];
    setStatus("waiting");
  }, []);

  // ── join room ────────────────────────────────────────────────────────────
  const joinRoom = useCallback((id: string) => {
    const socket = socketRef.current;
    if (!socket || !id.trim()) return;

    if (joinedRoomRef.current && joinedRoomRef.current !== id) {
      socket.emit("stopTrackBus", joinedRoomRef.current);
      resetMapState();
    }

    socket.emit("trackBus", id);
    joinedRoomRef.current = id;
  }, [resetMapState]);

  // ── stop animation ───────────────────────────────────────────────────────
  const stopAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  // ── jump marker ──────────────────────────────────────────────────────────
  const jumpToPosition = useCallback((pos: LatLng) => {
    currentPosRef.current = pos;
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker(pos, { icon: makeBusIcon() }).addTo(map);
    } else {
      markerRef.current.setLatLng(pos);
    }
    setStatus("waiting");
  }, []);

  // ── animate segment ──────────────────────────────────────────────────────
  const animateSegment = useCallback(
    (from: LatLng, to: LatLng, durationMs: number = DEFAULT_ANIM_MS) => {
      const map = mapRef.current;
      if (!map) return;

      if (document.visibilityState === "hidden") {
        jumpToPosition(to);
        return;
      }

      stopAnimation();

      const routePoints: LatLng[] = [from, to];
      routePointsRef.current = routePoints;
      cumulDistRef.current = buildCumulativeDist(routePoints);

      if (!markerRef.current) {
        markerRef.current = L.marker(from, { icon: makeBusIcon() }).addTo(map);
      } else {
        markerRef.current.setLatLng(from);
      }

      startTimeRef.current = null;
      setStatus("riding");

      const animate = (ts: number): void => {
        if (document.visibilityState === "hidden") {
          jumpToPosition(to);
          animFrameRef.current = null;
          return;
        }

        if (startTimeRef.current === null) startTimeRef.current = ts;
        const raw = Math.min((ts - startTimeRef.current) / durationMs, 1);
        const t = easeInOut(raw);
        const pos = getPositionAt(t, routePointsRef.current, cumulDistRef.current);

        markerRef.current?.setLatLng(pos);
        currentPosRef.current = pos;

        if (raw < 1) {
          const nextPos = getPositionAt(
            easeInOut(Math.min(raw + 0.01, 1)),
            routePointsRef.current,
            cumulDistRef.current
          );
          const deg = bearing(pos, nextPos);
          const iconEl = markerRef.current
            ?.getElement()
            ?.querySelector<HTMLDivElement>(".smt-bike-icon");
          if (iconEl) iconEl.style.transform = `rotate(${deg}deg)`;
        }

        if (raw < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          currentPosRef.current = to;
          markerRef.current?.setLatLng(to);
          setStatus("waiting");
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);
    },
    [stopAnimation, jumpToPosition]
  );

  // ── keep always-fresh refs ───────────────────────────────────────────────
  const joinRoomRef = useRef(joinRoom);
  const animateSegmentRef = useRef(animateSegment);
  useEffect(() => { joinRoomRef.current = joinRoom; }, [joinRoom]);
  useEffect(() => { animateSegmentRef.current = animateSegment; }, [animateSegment]);

  // ── scheduleNext ─────────────────────────────────────────────────────────
  const scheduleNextRef = useRef<() => void>(() => { });

  const scheduleNext = useCallback(() => {
    if (updateQueueRef.current.length === 0) {
      schedulerRef.current = null;
      return;
    }

    const now = Date.now();
    const elapsed = now - lastAnimStartRef.current;
    const isHidden = document.visibilityState === "hidden";
    // Pace against how long the *previous* segment was actually given to
    // animate, not a fixed slot — see DEFAULT_ANIM_MS comment.
    const delay = isHidden ? 0 : Math.max(0, lastSegmentDurationRef.current - elapsed);

    schedulerRef.current = setTimeout(() => {
      schedulerRef.current = null;

      const next = updateQueueRef.current.shift();
      if (!next) return;

      lastAnimStartRef.current = Date.now();
      const newPos: LatLng = [next.lat, next.lon];

      // Derive this segment's animation duration from the real gap between
      // this update's timestamp and the last one we displayed, clamped to a
      // sane range. Falls back to DEFAULT_ANIM_MS if we don't have a prior
      // timestamp yet or the gap looks bogus (<=0, e.g. out-of-order delivery).
      const prevTs = lastUpdateTimestampRef.current;
      const rawGap = prevTs !== null ? next.timestamp - prevTs : NaN;
      const duration = Number.isFinite(rawGap) && rawGap > 0
        ? Math.min(MAX_ANIM_MS, Math.max(MIN_ANIM_MS, rawGap))
        : DEFAULT_ANIM_MS;
      lastUpdateTimestampRef.current = next.timestamp;
      lastSegmentDurationRef.current = duration;

      if (currentPosRef.current === null) {
        currentPosRef.current = newPos;
        setStatus("waiting");
        const map = mapRef.current;
        if (map) {
          map.setView(newPos, 15);
          if (!markerRef.current) {
            markerRef.current = L.marker(newPos, { icon: makeBusIcon() }).addTo(map);
          }
        }
      } else {
        animateSegmentRef.current(currentPosRef.current, newPos, duration);
      }

      scheduleNextRef.current();
    }, delay);
  }, []);

  useEffect(() => { scheduleNextRef.current = scheduleNext; }, [scheduleNext]);

  // ── enqueueUpdate ────────────────────────────────────────────────────────
  const enqueueUpdate = useCallback((data: LocationUpdate) => {
    updateQueueRef.current.push(data);
    if (schedulerRef.current === null) {
      scheduleNextRef.current();
    }
  }, []);

  // ── visibility change handler ────────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const queue = updateQueueRef.current;
        if (queue.length > 1) {
          const latest = queue[queue.length - 1];
          updateQueueRef.current = [latest];
        }
        if (updateQueueRef.current.length > 0 && schedulerRef.current === null) {
          lastAnimStartRef.current = 0;
          scheduleNextRef.current();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ── init Leaflet ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([20.2961, 85.8245], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    map.whenReady(() => {
      loadRouteStops();
      setTimeout(() => map.invalidateSize(), 0);
    });

    const handleResize = () => map.invalidateSize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      map.remove();
      mapRef.current = null;
    };
  }, [loadRouteStops]);

  // ── Socket.IO ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tripId) return;

    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connecting");
      setTimeout(() => joinRoomRef.current(tripId), 100);
    });

    socket.on("disconnect", () => {
      setStatus("idle");
      joinedRoomRef.current = null;
    });

    socket.on("locationUpdate", (data: LocationUpdate) => {
      if (data.tripId !== joinedRoomRef.current) return;
      enqueueUpdate(data);
    });

    socket.on("lastKnownLocation", (data: LocationUpdate) => {
      if (data.tripId !== joinedRoomRef.current) return;
      const pos: LatLng = [data.lat, data.lon];
      currentPosRef.current = pos;
      setStatus("last_known");
      const map = mapRef.current;
      if (map) {
        map.setView(pos, 15);
        if (!markerRef.current) {
          markerRef.current = L.marker(pos, { icon: makeBusIcon(0.6) }).addTo(map);
        }
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flyToStop = useCallback((stop: Stop) => {
    mapRef.current?.flyTo([stop.lat, stop.lng], 16, { duration: 0.8 });
  }, []);

  const lastIdx = stops.length - 1;

  return (
    <div className="smt-root" data-theme={theme}>

      {/* Header */}
      <div className="smt-header">
        <div className="smt-brand">
          <svg className="smt-brand-icon" width="30" height="30" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" fill="rgba(26,115,232,0.12)" stroke="#1a73e8" strokeWidth="1.5"/>
            <polygon points="20,6 30,30 20,25 10,30" fill="#1a73e8" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="20" cy="20" r="2.5" fill="#ffffff"/>
          </svg>
          <h1 className="smt-title">Live<span>BUS</span></h1>
        </div>

        <div className="smt-header-actions">
          <div className={`smt-status-pill ${status === "idle" ? "disconnected" : ""}`}>
            <span className={`smt-status-dot ${status === "riding" ? "riding" : ""}`} />
            {STATUS_LABELS[status]}
          </div>

          <button
            type="button"
            className="smt-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="5" fill="currentColor"/>
                <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="12" y1="1.5" x2="12" y2="4"/>
                  <line x1="12" y1="20" x2="12" y2="22.5"/>
                  <line x1="1.5" y1="12" x2="4" y2="12"/>
                  <line x1="20" y1="12" x2="22.5" y2="12"/>
                  <line x1="4.2" y1="4.2" x2="6" y2="6"/>
                  <line x1="18" y1="18" x2="19.8" y2="19.8"/>
                  <line x1="4.2" y1="19.8" x2="6" y2="18"/>
                  <line x1="18" y1="6" x2="19.8" y2="4.2"/>
                </g>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Personal ETA banner for the user's chosen boarding/alighting stops */}
      {(boardAlight.board || boardAlight.alight) && (() => {
        const boardStop  = stops.find((s) => s.stop_name === boardAlight.board);
        const alightStop = stops.find((s) => s.stop_name === boardAlight.alight);
        const boardEta   = boardStop  ? etaMap[boardStop.seq]  : undefined;
        const alightEta  = alightStop ? etaMap[alightStop.seq] : undefined;
        if (!boardEta && !alightEta) return null;

        const describe = (eta: StopEta | undefined, label: string) => {
          if (!eta) return null;
          if (eta.passed) return `${label}: already passed`;
          if (eta.etaMinutes === null) return `${label}: ETA unknown`;
          return `${label} in ~${eta.etaMinutes} min`;
        };

        return (
          <div className="smt-eta-banner">
            {describe(boardEta, "Your boarding stop") && (
              <span className="smt-eta-banner-item">{describe(boardEta, "Your boarding stop")}</span>
            )}
            {describe(alightEta, "Your stop") && (
              <span className="smt-eta-banner-item">{describe(alightEta, "Your stop")}</span>
            )}
          </div>
        );
      })()}

      {/* Body: map + stops sidebar */}
      <div className="smt-body">

        {/* Map */}
        <div className="smt-map-wrap">
          <div className={`smt-map-div ${theme === "dark" ? "smt-map-dark" : ""}`} ref={mapContainerRef} />
        </div>

        {/* Stops sidebar */}
        <div className="smt-sidebar">
          <div className="smt-sidebar-header">
            <span className="smt-sidebar-title">Route Stops</span>
            {stops.length > 0 && <span className="smt-sidebar-count">{stops.length}</span>}
          </div>

          <div className="smt-stop-list">
            {stops.length === 0 && (
              <div className="smt-stop-empty">No stops loaded yet…</div>
            )}

            {stops.map((stop, i) => {
              const kind = i === 0 ? "source" : i === lastIdx ? "destination" : "mid";
              const eta = etaMap[stop.seq];
              const isBoard  = !!boardAlight.board  && stop.stop_name === boardAlight.board;
              const isAlight = !!boardAlight.alight && stop.stop_name === boardAlight.alight;

              const etaLabel = !eta
                ? "—"
                : eta.passed
                  ? "Passed"
                  : eta.etaMinutes !== null
                    ? `${eta.etaMinutes} min`
                    : "—";

              return (
                <div
                  key={`${stop.seq}-${i}`}
                  className={`smt-stop-item ${kind} ${isBoard ? "user-board" : ""} ${isAlight ? "user-alight" : ""}`}
                  onClick={() => flyToStop(stop)}
                >
                  <div className={`smt-stop-marker ${kind}`}>
                    {kind === "source" ? "S" : kind === "destination" ? "D" : i + 1}
                  </div>
                  <div className="smt-stop-info">
                    <div className="smt-stop-name">{stop.stop_name}</div>
                    <div className="smt-stop-tag">
                      {kind === "source" ? "Source" : kind === "destination" ? "Destination" : `Stop ${i + 1}`}
                      {isBoard  && " · You board here"}
                      {isAlight && " · You alight here"}
                    </div>
                  </div>
                  <div className={`smt-stop-eta ${eta?.passed ? "passed" : ""}`}>{etaLabel}</div>
                  {i < lastIdx && <div className="smt-stop-connector" />}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}