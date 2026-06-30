import '../styles/Driver.css';
import { useState } from "react";
import { useTracking } from "../hooks/useTracking";
import { startTrip, endTrip } from "../apis/trip.api";
import { BusIcon, LocationPin, ArrowRight } from "../icons/svg";


export default function Driver() {

  // Form State.
  const [busNo, setBusNo] = useState("");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");

  // Trip State.
  const [tripStarted, setTripStarted] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pin Stop State.
  const [pinning, setPinning] = useState(false);
  const [pinFeedback, setPinFeedback] = useState<"success" | "error" | null>(null);

  const python_backend_url = import.meta.env.VITE_PYTHON_BACKEND_URL || "http://localhost:8000";
  const environment = import.meta.env.VITE_ENVIRONMENT || "development";

  const { isTracking, busStatus, startTracking, stopTracking, resetTrip, lastSent, error, lastLocation } = useTracking(tripId);


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
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject)
      );
      const { latitude: lat, longitude: lng } = position.coords;
      const res = await startTrip({ busNo, source, destination, lat, lng });
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
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject)
      );
      const { latitude: lat, longitude: lng } = position.coords;
      if (tripId) {
        await endTrip(tripId, lat, lng);
        console.log("Trip Ended:", tripId);
      }
    } catch (err) {
      console.error("End trip failed", err);
    }
    stopTracking();
    resetTrip();
    setTripStarted(false);
    setTripId(null);
    setBusNo("");
    setSource("");
    setDestination("");
  };


  // 3. Pin Stop.
  const handlePinStop = async () => {
    if (!tripId) return;
    if (!lastLocation) {
      alert("No location available yet — wait for the first ping");
      return;
    }
    setPinning(true);
    setPinFeedback(null);
    try {
      const { lat, lon: lng } = lastLocation;
      const res = await fetch(`${python_backend_url}/api/trips/${tripId}/pin-stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      const data = await res.json();
      console.log("[pinStop] response:", data);
      if (!res.ok) throw new Error(data?.error || data?.message || "Pin stop request failed");
      console.log(`[pinStop] stop pinned at (${lat}, ${lng})`);
      setPinFeedback("success");
    } catch (err) {
      console.error("Pin stop failed:", err);
      setPinFeedback("error");
    } finally {
      setPinning(false);
      setTimeout(() => setPinFeedback(null), 3000);
    }
  };


  const pinBorderColor = pinFeedback === "success" ? "#2d4a2d" : pinFeedback === "error" ? "#4a2d2d" : "#1e3a5f";
  const pinBg = pinFeedback === "success" ? "#0d1a0d" : pinFeedback === "error" ? "#1a0d0d" : "#0a1628";
  const pinColor = pinFeedback === "success" ? "#4ade80" : pinFeedback === "error" ? "#f87171" : "#7dd3fc";
  const pinLabel = pinning
    ? "Pinning..."
    : pinFeedback === "success"
      ? "✓ Stop Pinned"
      : pinFeedback === "error"
        ? "✕ Pin Failed — Retry"
        : "PIN STOP";


  return (
    <>
      <div className="app">
        <div className="orb orb-1" />
        <div className="orb orb-2" />

        <div className="screen">

          {/* ── TOP BAR ── */}
          <div className="top-bar">
            <div className="app-wordmark">
              <span className="app-wordmark-my">My</span>
              <span className="app-wordmark-bus">BUS</span>
            </div>
            <div className="header-badge"><BusIcon /></div>
          </div>
          <div className="wm-underline">
            <div className="wm-line-main" />
            <div className="wm-line-dot" />
            <div className="wm-line-mini" />
          </div>

          {/* ── PAGE TITLE ── */}
          <div className="page-title">
            {tripStarted ? "Trip Control" : "New Trip"}
          </div>
          <div className="page-subtitle">
            {tripStarted
              ? "Manage your active trip and track location"
              : "Enter your route details to begin tracking"}
          </div>

          {/* ── FORM ── */}
          {!tripStarted && (
            <div className="fade-in">

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

              <div className="field">
                <div className="field-inner">
                  <span className="field-icon"><LocationPin /></span>
                  <div className="field-vr" />
                  <input
                    className="field-input"
                    placeholder="Origin"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </div>
              </div>

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

              {source && destination && (
                <div className="route-card fade-in">
                  <div className="route-left">
                    <div className="route-dot from" />
                    <div style={{ height: 32, width: 1, background: "linear-gradient(#f59e0b, #2563eb)", margin: "5px auto" }} />
                    <div className="route-dot to" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="route-label">{source}</div>
                    <div className="route-sub">Departure</div>
                    <div className="route-divider" />
                    <div className="route-label">{destination}</div>
                    <div className="route-sub">Destination</div>
                  </div>
                  <div style={{ color: "var(--muted)", flexShrink: 0 }}><ArrowRight /></div>
                </div>
              )}

              <button
                className="btn-cta"
                onClick={handleSubmitTrip}
                disabled={loading || !busNo || !source || !destination}
              >
                {loading ? "Starting..." : <>Start Trip <ArrowRight /></>}
              </button>
            </div>
          )}

          {/* ── CONTROL PANEL ── */}
          {tripStarted && (
            <div className="control-wrap fade-in">

              {/* Trip Badge */}
              <div className="trip-badge">
                <div className="trip-badge-dot" />
                <span>Active</span>
                <span className="trip-badge-id">{tripId}</span>
                <span className="trip-badge-bus">{busNo}</span>
              </div>

              {/* Start / Stop Tracking */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '28px 0 8px' }}>
                <button
                  className={`main-btn ${isTracking ? "active" : "inactive"}`}
                  onClick={() => { if (!tripId) return; isTracking ? stopTracking() : startTracking(); }}
                >
                  {isTracking ? "⏹ STOP TRACKING" : "▶ START TRACKING"}
                </button>
              </div>

              {/* Timer Row */}
              <div className="timer-row">
                <div className={`timer-dot ${isTracking ? "" : "off"}`} />
                {isTracking
                  ? `Last ping ${lastSent ?? 0}s ago`
                  : busStatus === "stopped" ? "Tracking stopped" : "Not tracking"}
              </div>

              {/* Live Location Card */}
              {lastLocation && (
                <div className="location-card">
                  <div className="location-card-header">
                    <span className="location-card-title">LAST PING</span>
                    <span className="location-card-time">{lastLocation.time}</span>
                  </div>
                  <div className="location-card-grid">
                    <div>
                      <div className="location-cell-label">LATITUDE</div>
                      <div className="location-cell-value">{lastLocation.lat.toFixed(6)}</div>
                    </div>
                    <div>
                      <div className="location-cell-label">LONGITUDE</div>
                      <div className="location-cell-value">{lastLocation.lon.toFixed(6)}</div>
                    </div>
                    <div>
                      <div className="location-cell-label">SPEED</div>
                      <div className="location-cell-value">
                        {(lastLocation.vel * 3.6).toFixed(1)}
                        <span className="location-cell-unit">km/h</span>
                      </div>
                    </div>
                    <div>
                      <div className="location-cell-label">ACCEL</div>
                      <div className="location-cell-value">
                        {lastLocation.acc.toFixed(2)}
                        <span className="location-cell-unit">m/s²</span>
                      </div>
                    </div>
                  </div>
                  <a
                    className="location-maps-link"
                    href={`https://www.google.com/maps?q=${lastLocation.lat},${lastLocation.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <LocationPin /> View on Google Maps ↗
                  </a>
                </div>
              )}

              {/* Pin Stop Button */}
              <button
                className="btn-pin"
                onClick={handlePinStop}
                disabled={pinning || !isTracking}
                style={{
                  border: `1px solid ${pinBorderColor}`,
                  background: pinBg,
                  color: pinColor,
                  cursor: pinning || !isTracking ? "not-allowed" : "pointer",
                  opacity: !isTracking ? 0.4 : 1,
                }}
              >
                {pinLabel}
              </button>

              {/* Error */}
              {error && (
                <div className="error-box">
                  <span>⚠ {error}</span>
                  {!isTracking && tripStarted && (
                    <button className="btn-resume" onClick={startTracking}>
                      Resume
                    </button>
                  )}
                </div>
              )}

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