// Generic API Request Helper.

const apiRequest = async (endpoint: string, options: RequestInit) => {
  try {

    // 1. Create full API URL.
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;
    const url = `${BACKEND_URL}${endpoint}`;

    // 2. Send Request.
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });

    // 3. Safe Response Parsing.
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    // 4. Log Response.
    console.log("API RESPONSE... ", data);
    if (!res.ok) throw new Error(data?.message || "API request failed");
    return data;

  } catch (err: any) {
    console.error("API ERROR... ", err.message || err);
    throw err;
  }
};


// 1. Start Trip API.
export const startTrip = async (
  data: { 
    busNo:       string,
    source:      string, 
    destination: string, 
    lat:         number, 
    lng:         number,
  }) => {

  console.log("Start Trip API called with:", data);
  return apiRequest("/api/trips/start-trip", {
    method: "POST",
    body: JSON.stringify({
      bus_number:  data.busNo, 
      source:      data.source,
      destination: data.destination,
      lat:         data.lat,    
      lng:         data.lng,    
    }),
  });
};


// 2. Send Location API.
export const sendLocation = async (
  data: { 
    tripId: string, 
    lat:    number, 
    lon:    number, 
    vel:    number, 
    acc:    number,
    status: string,
  }) => {

  console.log("Send Live Location API called with:", data);
  return apiRequest("/api/location/live", {
    method: "POST",
    body: JSON.stringify(data),
  });
};



// 3. End Trip API.
export const endTrip = async (
  tripId: string, 
  lat:    number, 
  lng:    number,
) => {

  console.log("End Trip API called with:", tripId);
  return apiRequest(`/api/trips/end-trip/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ lat, lng }),
  });
};



// 4. Search Buses API.
export const searchBuses = async (
  source:      string,
  destination: string,
) => {

  console.log("Search Buses API called with... ", { source, destination });
  return apiRequest(`/api/bus/search?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}`, {
    method: "GET",
  });
};



// 5. Get Stops API
export const getStops = async (tripId: string) => {
    console.log("Get Stops API called with:", tripId);
    return apiRequest(`/bus/trip/${tripId}/stops`, {
        method: "GET",
    });
};