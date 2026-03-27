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

  // Add this Status Config.
  const STATUS_CONFIG = {
    idle: { label: "Idle", color: "#5a6070", bg: "#0d0f14", border: "#1e2530" },
    moving: { label: "🟢 Moving", color: "#4ade80", bg: "#0d1a0d", border: "#2d4a2d" },
    stopped: { label: "🔴 Stopped", color: "#f87171", bg: "#1a0d0d", border: "#4a2d2d" },
  } as const;


  // 1. Start Trip.
  const handleSubmitTrip = async () => {
    if (!busNo || !source || !destination) {
      alert("Please fill all fields");
      return;
    }
    try {
      setLoading(true);

      // Wake Python Server.
      if (environment === "production") {
        await fetch(python_backend_url)
          .then(res => {
            if (!res.ok) throw new Error("Backend wake-up failed");
          })
          .catch(err => {
            console.error("Failed to wake backend... ", err);
          });
      }

      const res = await startTrip({ busNo, source, destination });
      const tripId = res.tripId;
      if (!tripId) {
        throw new Error("Invalid response from server");
      }
      console.log("Trip Started... ", tripId);
      setTripId(tripId);
      setTripStarted(true);

    } catch (err) {
      console.error("Start trip failed... ", err);
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
        console.log("Trip Ended... ", tripId);
      }
    } catch (err) {
      console.error("End trip failed... ", err);
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

          {/* FORM */}
          {!tripStarted && (
            <div className="fade-in">
              <div className="section-label">Enter Trip Details</div>

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
                    <div style={{ height: 28, width: 1, background: "linear-gradient(#f59e0b, #2563eb)", margin: "4px 3px" }} />
                    <div className="route-dot to" />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div className="route-label">{source}</div>
                    <div className="route-sub">Departure</div>
                    <div style={{ margin: "6px 0", height: 1, background: "var(--border)" }} />
                    <div className="route-label">{destination}</div>
                    <div className="route-sub">Destination</div>
                  </div>

                  <div style={{ color: "var(--muted)" }}>
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
                {loading ? "Starting Trip..." : <>Start Trip <ArrowRight /></>}
              </button>
            </div>
          )}

          {/* CONTROL PANEL */}
          {tripStarted && (
            <div className="control-wrap fade-in">

              {/* Trip ID */}
              <div className="trip-id-card" style={{ width: "100%" }}>
                <div className="trip-id-label">Trip ID</div>
                <div className="trip-id-value">
                  <div className="trip-id-dot" />
                  {tripId}  
                </div>
              </div>

              {/* Bus Status Pill */}
              <div className={`status-pill ${busStatus}`}>
                <div className="status-pill-dot" />
                {busStatus === "moving" ? "Moving" : busStatus === "stopped" ? "Stopped" : "Idle"}
              </div>

              {/* Big centered start/stop button */}
              <div className="orb-center">
                <div className="pulse-ring-wrap">
                  <div className={`ring ring-1 ${isTracking ? "active" : "inactive"}`} />
                  <div className={`ring ring-2 ${isTracking ? "active" : "inactive"}`} />
                  <div className={`ring ring-3 ${isTracking ? "active" : "inactive"}`} />
                  <button
                    className={`main-btn ${isTracking ? "active" : "inactive"}`}
                    onClick={() => { if (!tripId) return; isTracking ? stopTracking() : startTracking(); }}
                  >
                    {isTracking ? "STOP" : "START"}
                  </button>
                </div>

                {/* Last sent */}
                <div className="last-sent-row">
                  {isTracking
                    ? `Last sent: ${lastSent ?? 0}s ago`
                    : busStatus === "stopped" ? "Tracking stopped" : "Not tracking"}
                </div>
              </div>

              {error && <p style={{ color: "red", fontSize: 13 }}>{error}</p>}

              {/* End Trip */}
              <button className="btn-end" onClick={handleEndTrip}>
                END TRIP
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}