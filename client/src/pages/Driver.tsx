import '../styles/Driver.css';
import { useState } from "react";
import { useTracking } from "../hooks/useTracking";
import { startTrip, endTrip } from "../apis/trip.api";
import { BusIcon, LocationPin, ArrowRight } from "../icons/driver";


export default function Driver() {

  // Form State.
  const [busNo, setBusNo] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");

  // Trip State.
  const [tripStarted, setTripStarted] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const python_backend_url = import.meta.env.VITE_PYTHON_BACKEND_URL || "http://localhost:8000";
  const environment = import.meta.env.VITE_ENVIRONMENT || "development";

  // Tracking Hook.
  const { isTracking, busStatus, startTracking, stopTracking, lastSent, error } = useTracking(tripId);

  const STATUS_CONFIG = {
    idle:    { label: "Idle",      color: "#8e97ae", bg: "#f7f8fc", border: "#e2e6f0" },
    moving:  { label: "● Moving",  color: "#065f46", bg: "#d1fae5", border: "#6ee7b7" },
    stopped: { label: "● Stopped", color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5" },
  } as const;


  // 1. Start Trip.
  const handleSubmitTrip = async () => {
    if (!busNo || !source || !destination) {
      alert("Please fill all fields");
      return;
    }
    try {
      setLoading(true);

      if (environment === "production") {
        await fetch(python_backend_url)
          .then(res => {
            if (!res.ok) throw new Error("Backend wake-up failed");
            console.log("Backend woke up!");
          })
          .catch(err => {
            console.error("Failed to wake backend:", err);
          });
      }

      const res = await startTrip({ busNo, source, destination });
      const tripId = res.tripId;
      if (!tripId) throw new Error("Invalid response from server");

      console.log("Trip Started:", tripId);
      setTripId(tripId);
      setTripStarted(true);
    } catch (err) {
      console.error("Start trip failed:", err);
      alert("Failed to start trip");
    } finally {
      setLoading(false);
    }
  };


  // 2. End Trip.
  const handleEndTrip = async () => {
    try {
      if (tripId) {
        await endTrip(tripId);
        console.log("Trip Ended:", tripId);
      }
    } catch (err) {
      console.error("End trip failed", err);
    }
    stopTracking();
    setTripStarted(false);
    setTripId(null);
    setBusNo("");
    setSource("");
    setDestination("");
  };


  return (
    <>
      <div className="app">
        <div className="orb orb-1" />
        <div className="orb orb-2" />

        <div className="screen">

          {/* HEADER */}
          <div className="header">
            <div>
              <div className="header-label">LiveBus</div>
              <div className="header-title">
                {tripStarted ? "Trip Control" : "New Trip"}
              </div>
            </div>
            <div className="header-badge"><BusIcon /></div>
          </div>

          {/* ══ FORM VIEW ══ */}
          {!tripStarted && (
            <div className="fade-in">
              <div className="section-label">Trip Details</div>

              {/* Bus Number */}
              <div className="field">
                <div className="field-inner">
                  <span className="field-icon"><BusIcon /></span>
                  <div className="field-vr" />
                  <input
                    className="field-input"
                    placeholder="Vehicle Number (e.g. BUS-6042)"
                    value={busNo}
                    onChange={(e) => setBusNo(e.target.value)}
                  />
                </div>
              </div>

              {/* Source */}
              <div className="field">
                <div className="field-inner">
                  <span className="field-icon"><LocationPin /></span>
                  <div className="field-vr" />
                  <input
                    className="field-input"
                    placeholder="Origin / Source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </div>
              </div>

              {/* Destination */}
              <div className="field">
                <div className="field-inner">
                  <span className="field-icon" style={{ color: "#3b82f6" }}>
                    <LocationPin />
                  </span>
                  <div className="field-vr" />
                  <input
                    className="field-input"
                    placeholder="Destination"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  />
                </div>
              </div>

              {/* Route Preview */}
              {source && destination && (
                <div className="route-card fade-in">
                  <div className="route-left">
                    <div className="route-dot from" />
                    <div style={{
                      height: 30,
                      width: 1.5,
                      background: "linear-gradient(180deg, #f59e0b 0%, #fb923c 50%, #3b82f6 100%)",
                      margin: "5px 4px",
                      borderRadius: 2
                    }} />
                    <div className="route-dot to" />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="route-label">{source}</div>
                    <div className="route-sub">Departure</div>
                    <div style={{ margin: "8px 0", height: 1, background: "var(--border)" }} />
                    <div className="route-label">{destination}</div>
                    <div className="route-sub">Destination</div>
                  </div>

                  <div style={{
                    color: "var(--muted)",
                    background: "var(--surface2)",
                    borderRadius: 10,
                    padding: "8px",
                    display: "flex",
                    alignItems: "center",
                    border: "1px solid var(--border)",
                  }}>
                    <ArrowRight />
                  </div>
                </div>
              )}

              {/* Start Button */}
              <button
                className="btn-cta"
                onClick={handleSubmitTrip}
                disabled={loading || !busNo || !source || !destination}
              >
                {loading ? "Starting Trip…" : <><span>Start Trip</span> <ArrowRight /></>}
              </button>
            </div>
          )}

          {/* ══ CONTROL PANEL ══ */}
          {tripStarted && (
            <div className="control-wrap fade-in">

              {/* Trip Badge */}
              <div className="trip-badge" style={{ width: "100%" }}>
                <div className="trip-badge-dot" />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tripId}
                </span>
                <span style={{
                  background: "rgba(245,158,11,0.15)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  color: "#92400e",
                  fontSize: 11,
                  flexShrink: 0,
                }}>{busNo}</span>
              </div>

              {/* Bus Status Pill */}
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 20px",
                borderRadius: 999,
                border: `1.5px solid ${STATUS_CONFIG[busStatus].border}`,
                background: STATUS_CONFIG[busStatus].bg,
                color: STATUS_CONFIG[busStatus].color,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.04em",
                transition: "all 0.35s ease",
                boxShadow: "var(--shadow-sm)",
              }}>
                {STATUS_CONFIG[busStatus].label}
              </div>

              {/* Main Start/Stop Tracking Button with rings */}
              <div className="pulse-ring-wrap">
                <div className={`ring ring-1 ${isTracking ? "active" : "inactive"}`} />
                <div className={`ring ring-2 ${isTracking ? "active" : "inactive"}`} />
                <div className={`ring ring-3 ${isTracking ? "active" : "inactive"}`} />
                <button
                  className={`main-btn ${isTracking ? "active" : "inactive"}`}
                  onClick={() => { if (!tripId) return; isTracking ? stopTracking() : startTracking(); }}
                >
                  <span style={{ fontSize: 22 }}>{isTracking ? "⏹" : "▶"}</span>
                  {isTracking ? "STOP" : "START"}
                </button>
              </div>

              {/* Last Sent */}
              <div className="last-sent-row">
                {isTracking
                  ? `⏱ Last sent: ${lastSent ?? 0}s ago`
                  : busStatus === "stopped" ? "Tracking paused" : "Tap START to begin tracking"}
              </div>

              {/* Error */}
              {error && (
                <div className="error-box fade-in">
                  <span className="error-text">⚠ {error}</span>
                  {!isTracking && tripStarted && (
                    <button className="resume-btn" onClick={startTracking}>
                      Resume
                    </button>
                  )}
                </div>
              )}

              {/* End Trip */}
              <button className="btn-end" onClick={handleEndTrip}>
                <span style={{ fontSize: 16 }}>⬛</span> END TRIP
              </button>

            </div>
          )}

        </div>
      </div>
    </>
  );
}