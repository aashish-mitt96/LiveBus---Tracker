import { useState } from "react";
import { useNavigate } from "react-router-dom";
import '../styles/User.css'

// Pull recent trips from localStorage
function getRecentTrips(): string[] {
  try {
    return JSON.parse(localStorage.getItem("smt_recent_trips") || "[]");
  } catch {
    return [];
  }
}

function saveRecentTrip(id: string) {
  const prev = getRecentTrips().filter((t) => t !== id);
  localStorage.setItem(
    "smt_recent_trips",
    JSON.stringify([id, ...prev].slice(0, 5))
  );
}

export default function User() {
  const navigate = useNavigate();
  const [tripId, setTripId] = useState("");
  const [error, setError] = useState("");
  const recent = getRecentTrips();

  const handleTrack = (id: string = tripId) => {
    const clean = id.trim();
    if (!clean) {
      setError("Please enter a Trip ID before tracking.");
      return;
    }
    setError("");
    saveRecentTrip(clean);
    navigate(`/tracker/${encodeURIComponent(clean)}`);
  };

  return (
    <>
      <div className="up-root">
        <div className="up-card">
          <div className="up-icon">🚌</div>

          <h1 className="up-title">Track Your Bus</h1>
          <p className="up-sub">
            Enter the Trip ID shared by your operator
            <br />to get live location updates.
          </p>

          <div className="up-label">Trip ID</div>

          <div className="up-input-wrap">
            <span className="up-input-icon">🔑</span>
            <input
              className="up-input"
              placeholder="e.g. TRIP-20240601-001"
              value={tripId}
              onChange={(e) => {
                setTripId(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleTrack()}
              autoFocus
            />
          </div>

          <div className={`up-error ${error ? "visible" : ""}`}>{error}</div>

          <button className="up-btn" onClick={() => handleTrack()} disabled={!tripId.trim()}>
            <span>Track Live</span>
            <span>→</span>
          </button>

          {recent.length > 0 && (
            <>
              <hr className="up-divider" />
              <div className="up-hint-title">Recent Trips</div>
              <div className="up-recent">
                {recent.map((id) => (
                  <button
                    key={id}
                    className="up-recent-chip"
                    onClick={() => handleTrack(id)}
                  >
                    {id}
                    <span>track →</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="up-footer">
            powered by socket.io · osrm · leaflet
          </div>
        </div>
      </div>
    </>
  );
}