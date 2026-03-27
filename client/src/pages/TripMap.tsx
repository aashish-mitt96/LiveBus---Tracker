import { io, Socket } from "socket.io-client";
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";

import '../styles/TripMap.css'
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import type { Map, Marker, Polyline } from "leaflet";



type LatLng = [number, number];
type Status = "idle" | "connecting" | "riding" | "waiting" | "stopped" | "last_known";

interface LocationUpdate {
  tripId: string;
  lat: number;
  lon: number;
  vel?: number | null;
  acc?: number | null;
  timestamp: number;
}

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;
const ANIM_DURATION = 10_000;

const STATUS_LABELS: Record<Status, string> = {
  idle: "Waiting for connection…",
  connecting: "Connecting…",
  riding: "Bus moving",
  waiting: "Waiting for next location…",
  stopped: "Bus stopped",
  last_known: "Showing last known location",  
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

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

function buildFallbackPath(from: LatLng, to: LatLng, steps = 40): LatLng[] {
  const path: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const arc = Math.sin(t * Math.PI) * 0.003;
    path.push([lerp(from[0], to[0], t) + arc, lerp(from[1], to[1], t) + arc]);
  }
  return path;
}

interface LogEntry {
  id: number;
  text: string;
  isNew: boolean;
}

export default function BusTracker() {

  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const routeLayerRef = useRef<Polyline | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const currentPosRef = useRef<LatLng | null>(null);
  const routePointsRef = useRef<LatLng[]>([]);
  const cumulDistRef = useRef<number[]>([]);
  const joinedRoomRef = useRef<string | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<LocationUpdate | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logCountRef = useRef(0);

  const addLog = useCallback((text: string) => {
    const id = ++logCountRef.current;
    setLogs((prev) => {
      const updated = prev.map((e) => ({ ...e, isNew: false }));
      return [...updated, { id, text, isNew: true }].slice(-20);
    });
  }, []);

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
    currentPosRef.current = null;
    routePointsRef.current = [];
    cumulDistRef.current = [];
    setLastUpdate(null);
    setStatus("waiting");
  }, []);

  const joinRoom = useCallback((id: string) => {
    const socket = socketRef.current;
    if (!socket || !id.trim()) return;

    if (joinedRoomRef.current && joinedRoomRef.current !== id) {
      socket.emit("stopTrackBus", joinedRoomRef.current);
      addLog(`[${new Date().toLocaleTimeString()}] Left room: ${joinedRoomRef.current}`);
      resetMapState();
    }

    socket.emit("trackBus", id);
    joinedRoomRef.current = id;
    addLog(`[${new Date().toLocaleTimeString()}] Joined room: ${id} — waiting for updates…`);
  }, [addLog, resetMapState]);

  const handleLeave = useCallback(() => {
    const socket = socketRef.current;
    if (socket && joinedRoomRef.current) {
      socket.emit("stopTrackBus", joinedRoomRef.current);
    }
    joinedRoomRef.current = null;
    navigate("/");
  }, [navigate]);

  const stopAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const animateSegment = useCallback(
    (from: LatLng, to: LatLng) => {
      const map = mapRef.current;
      if (!map) return;

      stopAnimation();

      if (routeLayerRef.current) {
        map.removeLayer(routeLayerRef.current);
        routeLayerRef.current = null;
      }

      const run = (routePoints: LatLng[]) => {
        routePointsRef.current = routePoints;
        cumulDistRef.current = buildCumulativeDist(routePoints);

        routeLayerRef.current = L.polyline(routePoints, {
          color: "#4ade80",
          weight: 4,
          opacity: 0.65,
        }).addTo(map);

        map.fitBounds(routeLayerRef.current.getBounds(), { padding: [60, 60], maxZoom: 16 });

        if (!markerRef.current) {
          markerRef.current = L.marker(from, {
            icon: L.divIcon({
              className: "",
              html: `<div class="bike-icon-inner" id="smt-bike-icon">🚌</div>`,
              iconSize: [38, 38],
              iconAnchor: [19, 19],
            }),
          }).addTo(map);
        } else {
          markerRef.current.setLatLng(from);
        }

        startTimeRef.current = null;
        setStatus("riding");

        const animate = (ts: number): void => {
          if (startTimeRef.current === null) startTimeRef.current = ts;
          const raw = Math.min((ts - startTimeRef.current) / ANIM_DURATION, 1);
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
            const iconEl = document.getElementById("smt-bike-icon") as HTMLDivElement | null;
            if (iconEl) iconEl.style.transform = `rotate(${deg - 90}deg)`;
          }

          if (raw < 1) {
            animFrameRef.current = requestAnimationFrame(animate);
          } else {
            currentPosRef.current = to;
            setStatus("waiting");
            animFrameRef.current = null;
          }
        };

        animFrameRef.current = requestAnimationFrame(animate);
      };

      const url =
        `${OSRM_BASE}/${from[1]},${from[0]};${to[1]},${to[0]}` +
        `?overview=full&geometries=polyline`;

      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          if (data.code === "Ok" && data.routes?.length) {
            run(decodePolyline(data.routes[0].geometry));
          } else {
            run(buildFallbackPath(from, to));
          }
        })
        .catch(() => run(buildFallbackPath(from, to)));
    },
    [stopAnimation]
  );

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([28.62, 77.22], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!tripId) return;

    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setStatus("connecting");
      addLog(`[${new Date().toLocaleTimeString()}] Connected to server.`);
      setTimeout(() => joinRoom(tripId), 100);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setStatus("idle");
      joinedRoomRef.current = null;
      addLog(`[${new Date().toLocaleTimeString()}] Disconnected from server.`);
    });

    socket.on("locationUpdate", (data: LocationUpdate) => {
      if (data.tripId !== joinedRoomRef.current) return;

      const newPos: LatLng = [data.lat, data.lon];
      setLastUpdate(data);
      addLog(
        `[${new Date().toLocaleTimeString()}] Trip ${data.tripId.slice(-6)} → lat:${data.lat.toFixed(4)} lon:${data.lon.toFixed(4)}${data.vel != null ? ` vel:${data.vel}km/h` : ""}`
      );

      if (currentPosRef.current === null) {
        currentPosRef.current = newPos;
        setStatus("waiting");
        const map = mapRef.current;
        if (map) {
          map.setView(newPos, 15);
          if (!markerRef.current) {
            markerRef.current = L.marker(newPos, {
              icon: L.divIcon({
                className: "",
                html: `<div class="bike-icon-inner" id="smt-bike-icon">🚌</div>`,
                iconSize: [38, 38],
                iconAnchor: [19, 19],
              }),
            }).addTo(map);
          }
        }
        addLog(`[${new Date().toLocaleTimeString()}] First point set. Waiting for next location…`);
      } else {
        animateSegment(currentPosRef.current, newPos);
      }
    });

    socket.on("lastKnownLocation", (data: LocationUpdate) => {
      if (data.tripId !== joinedRoomRef.current) return;

      const pos: LatLng = [data.lat, data.lon];
      currentPosRef.current = pos;
      setLastUpdate(data);
      setStatus("last_known");

      const map = mapRef.current;
      if (map) {
        map.setView(pos, 15);
        if (!markerRef.current) {
          markerRef.current = L.marker(pos, {
            icon: L.divIcon({
              className: "",
              html: `<div class="bike-icon-inner" id="smt-bike-icon" style="opacity:0.6">🚌</div>`,
              iconSize: [38, 38],
              iconAnchor: [19, 19],
            }),
          }).addTo(map);
        }
      }

      const age = Math.round((Date.now() - data.timestamp) / 1000 / 60);
      addLog(`[${new Date().toLocaleTimeString()}] Last known location (${age}m ago) → lat:${data.lat.toFixed(4)} lon:${data.lon.toFixed(4)}`);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // intentionally once; joinRoom / animateSegment are stable

  // ── derived UI ────────────────────────────────────────────────────────────
  const chipClass =
    status === "riding" ? "active" :
      status === "waiting" ? "waiting" :
        status === "last_known" ? "waiting" :
          status === "stopped" ? "error" : "";

  return (
    <>
      <div className="smt-root">

        {/* Header */}
        <div className="smt-header">
          <h1 className="smt-title">Bus Tracker</h1>
          <span className={`smt-badge ${connected ? "" : "disconnected"}`}>
            {connected ? "● Live" : "○ Disconnected"}
          </span>
          {tripId && (
            <span className="smt-badge" style={{ background: "#1a1f2f", borderColor: "#2d3a5a", color: "#93c5fd" }}>
              room: {tripId.slice(-8)}
            </span>
          )}
          <button className="smt-back-btn" onClick={handleLeave}>
            ← Back
          </button>
        </div>

        {/* Map */}
        <div className="smt-map-wrap">
          <div className="smt-map-div" ref={mapContainerRef} />

          <div className="smt-overlay">
            <div className="smt-overlay-label">Status</div>
            <div className="smt-overlay-val">{STATUS_LABELS[status]}</div>

            {tripId && (
              <div className="smt-overlay-tripid">
                trip: {tripId}
              </div>
            )}

            {lastUpdate && (
              <div className="smt-overlay-row">
                <div className="smt-overlay-meta">lat: {lastUpdate.lat.toFixed(5)}</div>
                <div className="smt-overlay-meta">lon: {lastUpdate.lon.toFixed(5)}</div>
                {lastUpdate.vel != null && (
                  <div className="smt-overlay-meta">vel: {lastUpdate.vel} km/h</div>
                )}
                <div className="smt-overlay-meta" style={{ marginTop: 6, color: "#3a4050" }}>
                  {new Date(lastUpdate.timestamp).toLocaleTimeString()}
                </div>
              </div>
            )}

            {status === "riding" && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <div className="pulse-dot" />
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#4ade80" }}>
                  animating…
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Status chips */}
        <div className="smt-status-row">
          <div className={`smt-chip ${chipClass}`}>{STATUS_LABELS[status]}</div>
          <div className={`smt-chip ${connected ? "active" : "error"}`}>
            {connected ? "Socket connected" : "Socket disconnected"}
          </div>
          <div className="smt-chip active">tracking room</div>
          <div className="smt-chip">10s segments</div>
          <div className="smt-chip">OSRM road routing</div>
        </div>

        {/* Event log */}
        <div className="smt-log">
          <div className="smt-log-title">Event log</div>
          {logs.length === 0 && (
            <div className="smt-log-entry">No events yet…</div>
          )}
          {logs.map((entry) => (
            <div key={entry.id} className={`smt-log-entry ${entry.isNew ? "new" : ""}`}>
              {entry.text}
            </div>
          ))}
        </div>

      </div>
    </>
  );
}