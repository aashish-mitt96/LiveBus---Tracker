import { useState } from "react";
import '../styles/User.css';
import { searchBuses, getStops } from "../apis/trip.api";
import { BusIcon } from "../icons/svg";


type Bus = {
  tripId:        string;
  bus_number:    string;
  source:        string;
  destination:   string;
  status:        string;
  board_at:      string;
  alight_at:     string;
  stops_between: number;
};


function PlannerTrack() {
  return (
    <svg viewBox="0 0 22 100" preserveAspectRatio="none">
      <path
        d="M11,8 C21,34 1,66 11,92"
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth="2"
        strokeDasharray="1 6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="11" cy="8" r="5" fill="#fff" stroke="var(--primary)" strokeWidth="3" />
      <circle cx="11" cy="92" r="5" fill="var(--primary)" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="9.5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 15c3-1 4-9 8-9s2 8 8 8" stroke="currentColor" strokeWidth="1.8" strokeDasharray="1 4" strokeLinecap="round" />
      <path d="M16 12l4 2-4 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


export default function User() {

  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [filteredBuses, setFilteredBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);


  // 1. Search for buses based on source and destination.
  const handleSearch = async () => {
    if (!source || !destination) {
      alert("Please enter source and destination");
      return;
    }
    const s = source.trim().toLowerCase();
    const d = destination.trim().toLowerCase();
    if (s === d) {
      alert("Source and destination cannot be same");
      return;
    }
    try {
      setLoading(true);
      setSearched(false);
      const data = await searchBuses(source, destination);
      setFilteredBuses(data);
      setSearched(true);
    } catch (err) {
      console.error("Error fetching buses:", err);
      alert("Failed to fetch buses");
    } finally {
      setLoading(false);
    }
  };


  // 2. Swap source and destination values.
  const handleSwap = () => {
    setSource(destination);
    setDestination(source);
  };


  // 3. Saves Route details to localStorage and navigates to the bus tracking page.
  const handleTrack = async (bus: Bus) => {
    // Remember which stops the user actually chose to board/alight at, so the
    // tracker page can highlight them and surface a personalized ETA.
    localStorage.setItem("trackBoardAlight", JSON.stringify({
      board:  bus.board_at,
      alight: bus.alight_at,
    }));
    try {
      const res = await getStops(bus.tripId);
      const stops = (res.stops || []).map((entry: any) => ({
        lat:       entry.stop.lat,
        lng:       entry.stop.lng,
        stop_name: entry.stop.stopName,
      }));
      localStorage.setItem("trackRoute", JSON.stringify(stops));
    } catch (err) {
      console.error("Failed to fetch stops, tracking without route overlay:", err);
      localStorage.removeItem("trackRoute");
    } finally {
      window.location.href = `/tracker/${bus.tripId}`;
    }
  };


  return (
    <div className="app">

      {/* ── HERO BANNER ── */}
      <div className="hero-banner">
        <div className="topbar">
          <div className="brand">
            <div className="brand-badge"><BusIcon /></div>
            <div className="brand-name">Live<span>BUS</span></div>
          </div>
          <div className="topbar-tag">live tracking</div>
        </div>

        <div className="hero-title">Where are you<br />heading today?</div>
        <div className="hero-sub">Search a route to see which buses are running right now.</div>
      </div>

      {/* ── PLANNER CARD ── */}
      <div className="planner-card">
        <div className="planner-body">
          <div className="planner-track"><PlannerTrack /></div>

          <div className="planner-fields">
            <div className="planner-field">
              <label>From</label>
              <input
                className="planner-input"
                placeholder="Enter Source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </div>
            <div className="planner-field">
              <label>To</label>
              <input
                className="planner-input"
                placeholder="Enter Destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>
          </div>

          <button className="planner-swap" onClick={handleSwap} title="Swap">⇅</button>
        </div>

        <button className="planner-cta" onClick={handleSearch} disabled={loading}>
          {loading ? <><div className="spinner" /> Searching…</> : <>Find buses →</>}
        </button>
      </div>

      {/* ── CONTENT ── */}
      <div className="content">

        {/* Loading Skeleton */}
        {loading && [0, 1].map((i) => (
          <div className="skel-card" key={i}>
            <div className="skel-row">
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 12 }} />
              <div className="skeleton" style={{ width: 100, height: 14 }} />
              <div style={{ flex: 1 }} />
              <div className="skeleton" style={{ width: 56, height: 20, borderRadius: 20 }} />
            </div>
            <div className="skeleton" style={{ height: 14, width: "70%" }} />
            <div className="skeleton" style={{ height: 12, width: "45%" }} />
          </div>
        ))}

        {/* Before Search */}
        {!searched && !loading && (
          <div className="prompt">
            <div className="state-icon"><PinIcon /></div>
            <div className="prompt-title">Plan your journey</div>
            <div className="prompt-sub">
              Enter your source &amp; destination above<br />
              to find buses on your route
            </div>
          </div>
        )}

        {/* Results */}
        {searched && !loading && (
          <>
            <div className="section-header">
              <div className="section-title">Available buses</div>
              {filteredBuses.length > 0 && (
                <div className="section-count">{String(filteredBuses.length).padStart(2, "0")} found</div>
              )}
            </div>

            {filteredBuses.length === 0 ? (
              <div className="empty">
                <div className="state-icon"><EmptyIcon /></div>
                <div className="empty-title">No buses found</div>
                <div className="empty-sub">
                  No buses available on this route.<br />
                  Try different stops.
                </div>
              </div>
            ) : (
              filteredBuses.map((bus, i) => (
                <div
                  key={bus.tripId}
                  className="bus-card fade-in"
                  style={{ animationDelay: `${i * 70}ms` }}
                  onClick={() => handleTrack(bus)}
                >
                  <div className="bus-card-top">
                    <div className="bus-id">
                      <div className="bus-id-badge">
                        {bus.bus_number.replace(/[^A-Z0-9]/gi, "").slice(0, 4)}
                      </div>
                      <div>
                        <div className="bus-trip-code">TRIP #{bus.tripId}</div>
                        <div className="bus-number">{bus.bus_number}</div>
                      </div>
                    </div>

                    <div className={`status-pill ${bus.status === "active" ? "active" : "inactive"}`}>
                      <div className="status-dot" />
                      {bus.status === "active" ? "ACTIVE" : "OFFLINE"}
                    </div>
                  </div>

                  <div className="route-row">
                    <div className="route-city">{bus.source}</div>
                    <div className="route-connector">
                      <div className="route-chip"><BusIcon /></div>
                    </div>
                    <div className="route-city">{bus.destination}</div>
                  </div>

                  <div className="bus-stats">
                    <div className="bus-stats-group">
                      <div className="bus-stat">
                        <span className="bus-stat-label">Board</span>
                        <span className="bus-stat-value">{bus.board_at || "—"}</span>
                      </div>
                      <div className="bus-stat">
                        <span className="bus-stat-label">Alight</span>
                        <span className="bus-stat-value">{bus.alight_at || "—"}</span>
                      </div>
                    </div>
                    <div className="bus-stats-arrow">→</div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

      </div>
    </div>
  );
}