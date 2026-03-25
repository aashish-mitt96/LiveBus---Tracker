// Generic API Request Helper.
const apiRequest = async (endpoint: string, options: RequestInit) => {
  try {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;
    const url = `${BACKEND_URL}${endpoint}`;

    // Safe Body Parsing.
    let parsedBody = null;
    try {
      parsedBody =
        typeof options.body === "string"
          ? JSON.parse(options.body)
          : options.body || null;
    } catch {
      parsedBody = options.body;
    }

    // Log Request.
    console.log("API REQUEST:");
    console.log("TIME:", new Date().toISOString());
    console.log("URL:", url);
    console.log("METHOD:", options.method);
    console.log("BODY:", parsedBody);

    // Send Request.
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    // Safe response parsing.
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    // Log Response.
    console.log("API RESPONSE:", data);

    if (!res.ok) {
      throw new Error(data?.message || "API request failed");
    }
    return data;
  } catch (err: any) {
    console.error("API ERROR:", err.message || err);
    throw err;
  }
};


// 1. Start Trip API.
export const startTrip = async (data: { busNo: string; source: string; destination: string }) => {
  console.log("Start Trip API called with:", data);
  return apiRequest("/api/trips/start-trip", {
    method: "POST",
    body: JSON.stringify({
      bus_number: data.busNo, 
      source: data.source,
      destination: data.destination,
    }),
  });
};


// 2. Send Location API.
export const sendLocation = async (data: { tripId: string; lat: number; lon: number; vel: number; acc: number }) => {
  console.log("Send Live Location API called with:", data);
  return apiRequest("/api/location/live", {
    method: "POST",
    body: JSON.stringify(data),
  });
};


// 3. End Trip API.
export const endTrip = async (tripId: string) => {
  console.log("End Trip API called with:", tripId);
  return apiRequest(`/api/trips/end-trip/${tripId}`, {
    method: "PATCH",
  });
};