# Trip API Reference

## Base URL
Configured via `VITE_BACKEND_URL` environment variable.


## Endpoints

### 1. Start Trip
**POST** `/api/trips/start-trip`


**Body**
```json
{
  "bus_number": "string",
  "source": "string",
  "destination": "string"
}
```

---

### 2. Send Live Location
**POST** `/api/location/live`


**Body**
```json
{
  "tripId": "string",
  "lat": "number",
  "lon": "number",
  "vel": "number",
  "acc": "number",
  "status": "string",
}
```

---

### 3. End Trip
**PATCH** `/api/trips/end-trip/:tripId`


**Params**
- `tripId` — ID of the trip to end.

---

### 4. Search Buses
**GET** `/api/bus/search?source=&destination=`

Returns a list of buses available for a given route.

**Query Params**
- `source` — Origin location.
- `destination` — Destination location.