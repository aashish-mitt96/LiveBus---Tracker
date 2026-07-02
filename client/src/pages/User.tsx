import { useState } from "react";
import '../styles/User.css';
import { searchBuses, getStops } from "../apis/trip.api";
  

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

      {/* NAV */}
      <div className="nav">
        <div className="nav-top">
          <div className="nav-brand">
            <div className="nav-logo">🚌</div>
            <div className="nav-name">BusGo</div>
          </div>
        </div>
        <div className="nav-greeting">Good morning,</div>
        <div className="nav-headline">
          Where are you<br />heading today?
        </div>
      </div>

      {/* SEARCH */}
      <div className="red-bridge">
        <div className="search-card">

          <div className="field" style={{ paddingRight: 14 }}>
            <div className="field-dot dot-from" />
            <div className="field-inner">
              <div className="field-label">From</div>
              <input
                className="field-input"
                placeholder="Enter city or stop"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </div>
          </div>

          <div className="field-sep-wrap">
            <div className="field-sep" />
            <button className="swap-btn" onClick={handleSwap} title="Swap">⇅</button>
          </div>

          <div className="field" style={{ paddingRight: 14 }}>
            <div className="field-dot dot-to" />
            <div className="field-inner">
              <div className="field-label">To</div>
              <input
                className="field-input"
                placeholder="Enter city or stop"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>
          </div>

          <button className="search-btn" onClick={handleSearch} disabled={loading}>
            {loading
              ? <><div className="spinner" /> Searching buses…</>
              : <>Search Buses</>
            }
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div className="content">

        {/* Loading Skeleton */}
        {loading && [0, 1].map((i) => (
          <div className="skel-card" key={i}>
            <div className="skel-row">
              <div className="skeleton" style={{ width: 64, height: 28 }} />
              <div className="skeleton" style={{ width: 100, height: 14 }} />
              <div style={{ flex: 1 }} />
              <div className="skeleton" style={{ width: 56, height: 22, borderRadius: 20 }} />
            </div>
            <div className="skeleton" style={{ height: 12, width: "80%" }} />
            <div className="skeleton" style={{ height: 12, width: "55%" }} />
          </div>
        ))}

        {/* Before Search */}
        {!searched && !loading && (
          <div className="prompt">
            <span className="prompt-emoji">🗺️</span>
            <div className="prompt-title">Plan your journey</div>
            <div className="prompt-sub">
              Enter your source & destination above<br />
              to find buses on your route
            </div>
          </div>
        )}

        {/* Results */}
        {searched && !loading && (
          <>
            <div className="section-header">
              <div className="section-title">Available Buses</div>
              {filteredBuses.length > 0 && (
                <div className="section-badge">{filteredBuses.length} found</div>
              )}
            </div>

            {filteredBuses.length === 0 ? (
              <div className="empty">
                <span className="empty-emoji">😕</span>
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
                  className="bus-card"
                  style={{
                    animationDelay: `${i * 70}ms`,
                    cursor: "pointer",
                    opacity: bus.status === "active" ? 1 : 0.6
                  }}
                  onClick={() => handleTrack(bus)}
                >
                  <div className="bus-card-head">
                    <div className="bus-left">
                      <div className="bus-num-badge">{bus.bus_number}</div>
                      <div>
                        <div className="bus-trip">TRIP #{bus.tripId}</div>
                        <div className="bus-type">Express Bus</div>
                      </div>
                    </div>

                    <div className={`status-pill ${bus.status === "active" ? "active" : "inactive"}`}>
                      <div className="status-dot" />
                      {bus.status === "active" ? "Live" : "Offline"}
                    </div>
                  </div>

                  {/* SOURCE & DESTINATION */}
                  <div className="bus-card-body">
                    <div className="timeline-row">
                      <div className="timeline-track">
                        <div className="t-dot t-dot-src" />
                        <div className="t-line" />
                      </div>
                      <div className="timeline-stop">
                        <div className="stop-name-main">
                          {bus.source}
                          <span className="stop-tag stop-tag-src">Boarding</span>
                        </div>
                      </div>
                    </div>

                    <div className="timeline-row">
                      <div className="timeline-track">
                        <div className="t-dot t-dot-dst" />
                      </div>
                      <div className="timeline-stop" style={{ paddingBottom: 0 }}>
                        <div className="stop-name-main is-dst">
                          {bus.destination}
                          <span className="stop-tag stop-tag-dst">Drop</span>
                        </div>
                      </div>
                    </div>
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