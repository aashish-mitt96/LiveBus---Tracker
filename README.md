# LiveBus — Real Time Bus Tracking & ETA Platform

LiveBus is a real-time public-transit tracking system: a driver's phone streams GPS pings, passengers watch the bus move live on a map, and the system predicts arrival times at every stop — even when the driver's GPS momentarily drops (tunnels, dead zones, poor signal). Unlike a typical "GPS on a map" demo, LiveBus **discovers its own route network from live traffic** (no manual route/stop entry required) and **learns typical bus speed per route, per time-of-day** to make its ETAs progressively smarter.

It's built as **three cooperating services**:

| Service | Tech | Responsibility |
|---|---|---|
| `client` | React 19 + TypeScript + Vite + Leaflet + Capacitor | Driver app, passenger map, bus search |
| `node-server` | Express + TypeScript + Drizzle ORM + Socket.IO + Redis | Trip/route lifecycle, live-location ingestion, ETA API, real-time broadcast |
| `python-server` | FastAPI + scikit-learn + SQLAlchemy | GPS dead-reckoning predictor: Kalman filter + a trained per-route speed model |

---
