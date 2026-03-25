import { useEffect, useRef, useState } from "react";
import { sendLocation } from "../apis/trip.api";


// Custom Hook for GPS Tracking.
export const useTracking = (tripId: string | null) => {

  const [isTracking, setIsTracking] = useState(false);
  const [busStatus, setBusStatus] = useState<"idle" | "moving" | "stopped">("idle");
  const [lastSent, setLastSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSpeedRef = useRef<number>(0);
  const prevTimeRef = useRef<number>(Date.now());
  const isSendingRef = useRef<boolean>(false);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);

  // 1. Start Tracking.
  const startTracking = () => {
    if (!tripId) {
      setError("Trip not Initialized... ");
      return;
    }
    if (!navigator.geolocation) {
      console.error("Geolocation not Supported... ");
      setError("Geolocation not supported... ");
      return;
    }
    if (intervalRef.current) return;

    setIsTracking(true);
    setBusStatus("moving");
    setError(null);

    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (isSendingRef.current) return;
          try {

            isSendingRef.current = true;
            const { latitude, longitude, speed } = pos.coords;
            lastPosRef.current = { lat: latitude, lon: longitude };

            const velocity = speed !== null && speed !== undefined ? speed : prevSpeedRef.current; 
            const now = Date.now();
            const deltaTime = (now - prevTimeRef.current) / 1000;
            const acceleration = deltaTime > 0 ? (velocity - prevSpeedRef.current) / deltaTime : 0;

            // Update Reference.
            prevSpeedRef.current = velocity;
            prevTimeRef.current = now;

            // Log Location.
            console.log("LOCATION UPDATE... ", {
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
            console.error("Send error... ", err);
            setError("Failed to send location... ");
          } finally {
            isSendingRef.current = false;
          }
        },
        (err) => {
          console.error("GPS error... ", err);
          setError("GPS unavailable... ");
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
  const stopTracking = async () => {
    setIsTracking(false);
    setBusStatus("stopped");
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (tripId) {
      try {
        await sendLocation({ tripId, lat: lastPosRef.current?.lat ?? 0, lon: lastPosRef.current?.lon ?? 0, vel: 0, acc: 0 });
        console.log("Stopped at... ", lastPosRef.current);
      } catch (err) {
        console.error("Failed to send stop Signal.. ", err);
      }
    }

    // Reset Values.
    prevSpeedRef.current = 0;
    prevTimeRef.current = Date.now();
    lastPosRef.current = null;
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


  return { isTracking, busStatus, startTracking, stopTracking, lastSent, error }
};