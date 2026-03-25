import { useEffect, useRef, useState } from "react";
import { sendLocation } from "../apis/trip.api";


// Custom Hook for GPS Tracking.
export const useTracking = (tripId: string | null) => {

  const [isTracking, setIsTracking] = useState(false);
  const [lastSent, setLastSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Previous Values.
  const prevSpeedRef = useRef<number>(0);
  const prevTimeRef = useRef<number>(Date.now());

  // Prevent Overlapping API Calls.
  const isSendingRef = useRef<boolean>(false);


  // 1. Start Tracking.
  const startTracking = () => {
    if (!tripId) {
      setError("Trip not initialized");
      return;
    }
    if (!navigator.geolocation) {
      console.error("Geolocation not supported");
      setError("Geolocation not supported");
      return;
    }
    if (intervalRef.current) return;

    setIsTracking(true);
    setError(null);

    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (isSendingRef.current) return;
          try {
            isSendingRef.current = true;
            const { latitude, longitude, speed } = pos.coords;
            const velocity =
              speed !== null && speed !== undefined
                ? speed
                : prevSpeedRef.current; const now = Date.now();
            const deltaTime = (now - prevTimeRef.current) / 1000;
            const acceleration = deltaTime > 0 ? (velocity - prevSpeedRef.current) / deltaTime : 0;

            // Update Reference.
            prevSpeedRef.current = velocity;
            prevTimeRef.current = now;

            // Log Location.
            console.log("📍 LOCATION UPDATE:", {
              lat: latitude,
              lon: longitude,
              vel: velocity,
              acc: acceleration,
              time: new Date().toLocaleTimeString(),
            });

            // Send to Backend.
            await sendLocation({ tripId, lat: latitude, lon: longitude, vel: velocity, acc: acceleration });

            // Reset Timer Display.
            setLastSent(0);

          } catch (err) {
            console.error("Send error:", err);
            setError("Failed to send location");
          } finally {
            isSendingRef.current = false;
          }
        },
        (err) => {
          console.error("GPS error:", err);
          setError("GPS unavailable");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
      // Runs Every 10 Seconds.
    }, 10000);
  };


  // 2. Stop Tracking.
  const stopTracking = () => {
    setIsTracking(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Reset Values.
    prevSpeedRef.current = 0;
    prevTimeRef.current = Date.now();
  };


  // 3. Timer For Last Seen.
  useEffect(() => {
    if (!isTracking) return;
    const timer = setInterval(() => {
      setLastSent((prev) => (prev !== null ? prev + 1 : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [isTracking]);


  // 4. Cleanup on Unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);


  return { isTracking, startTracking, stopTracking, lastSent, error }
};