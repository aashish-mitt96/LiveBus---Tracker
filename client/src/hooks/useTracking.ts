import { useEffect, useRef, useState } from "react";
import { sendLocation } from "../apis/trip.api";


export const useTracking = (tripId: string | null) => {

  const [isTracking, setIsTracking]  = useState(false);
  const [busStatus, setBusStatus]    = useState<"idle" | "moving" | "stopped">("idle");
  const [lastSent, setLastSent]      = useState<number | null>(null);
  const [error, setError]            = useState<string | null>(null);

  const watchIdRef      = useRef<number | null>(null);
  const intervalRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSendingRef    = useRef<boolean>(false);
  const isTrackingRef   = useRef<boolean>(false);
  const lastPosRef      = useRef<{ lat: number; lon: number; vel: number; acc: number } | null>(null);
  const prevSpeedRef    = useRef<number>(0);
  const prevTimeRef     = useRef<number>(Date.now());
  const lastSendTimeRef = useRef<number>(0);


  // 1. SEND LOCATION TO SERVER.
  const sendPing = async ( 
    latitude: number, 
    longitude: number, 
    velocity: number, 
    acceleration: number, 
    status: "moving" | "stopped" 
  ) => {

    if (!tripId || isSendingRef.current) return;
    try {
      isSendingRef.current = true;

      // Store Latest Position.
      lastPosRef.current = { lat: latitude, lon: longitude, vel: velocity, acc: acceleration };
      console.log("📍 LOCATION UPDATE:", {
        lat: latitude, lon: longitude,
        vel: velocity, acc: acceleration,
        time: new Date().toLocaleTimeString(),
      });

      // // API Call.
      await sendLocation({ tripId, lat: latitude, lon: longitude, vel: velocity, acc: acceleration, status });
      setLastSent(0);
      setError(null);

    } catch (err) {
      console.error("Send error:", err);
      setError("Failed to send location");
    } finally {
      isSendingRef.current = false;
    }
  };


  // 2. FALLBACK SENDER: GUARANTEES LOCATION UPDATES EVERY 10s.
  const startSendTimer = () => {

    if (sendTimerRef.current) clearInterval(sendTimerRef.current);
    sendTimerRef.current = setInterval(async () => {
      if (!isTrackingRef.current || !lastPosRef.current || isSendingRef.current) return;
      const nowTime = Date.now();
      
      if (nowTime - lastSendTimeRef.current >= 10_000) {
        const { lat, lon, vel, acc } = lastPosRef.current;
        lastSendTimeRef.current = nowTime;
        setBusStatus("moving");
        await sendPing(lat, lon, vel, acc, "moving");
      }
    }, 10_000);
  };


  // 3. START GPS TRACKING.
  const attachWatch = () => {
    if (!navigator.geolocation) { setError("Geolocation not supported"); return; }
    
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Start Watching Position.
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed } = pos.coords;
        const velocity = speed !== null && speed !== undefined ? speed : prevSpeedRef.current;
        const now = Date.now();
        const deltaTime = (now - prevTimeRef.current) / 1000;
        const acceleration = deltaTime > 0 ? (velocity - prevSpeedRef.current) / deltaTime : 0;
        prevSpeedRef.current = velocity;
        prevTimeRef.current  = now;

        // Store Latest Position.
        lastPosRef.current = { lat: latitude, lon: longitude, vel: velocity, acc: acceleration };
        setError(null);

        // Primary Sending Logic: Send Immediately on GPS Update, but only if not sent in last 10s.
        const nowTime = Date.now();
        if (isTrackingRef.current && nowTime - lastSendTimeRef.current >= 10_000 && !isSendingRef.current) {
          lastSendTimeRef.current = nowTime;
          setBusStatus("moving");
          sendPing(latitude, longitude, velocity, acceleration, "moving");
        }
      },
      (err) => {
        console.error("GPS error:", err);
        setError("GPS lost — tap START to resume");
        isTrackingRef.current = false;
        setIsTracking(false);
        setBusStatus("stopped"); 

        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        if (sendTimerRef.current) {
          clearInterval(sendTimerRef.current);
          sendTimerRef.current = null;
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
    // Start Backup Sending Mechanism.
    startSendTimer();
  };


  // 4. HANDLE TAB VISIBILITY CHANGE.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isTrackingRef.current) {
        console.log("👁 Tab visible — checking timers");

        if (sendTimerRef.current === null) {
          console.log("🔁 Restarting send timer");
          startSendTimer(); 
        }
        if (watchIdRef.current === null) {
          console.warn("⚠️ GPS lost — restart required");
          setError("GPS paused — tap START to resume");
          setIsTracking(false);
          isTrackingRef.current = false;
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);


  // 5. START TRACKING.
  const startTracking = () => {
    if (!tripId) { setError("Trip not initialized"); return; }
    if (isTrackingRef.current) return;

    isTrackingRef.current   = true;
    lastSendTimeRef.current = Date.now(); 

    setIsTracking(true);
    setBusStatus("moving");
    setError(null);

    attachWatch();
  };


  // 6. STOP TRACKING.
  const stopTracking = async () => {
    isTrackingRef.current = false;
    setIsTracking(false);
    setBusStatus("stopped");

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
    if (intervalRef.current)  { clearInterval(intervalRef.current);  intervalRef.current  = null; }

    const lastPos = lastPosRef.current;
    if (tripId && lastPos) {
      try {
        await sendLocation({ tripId, lat: lastPos.lat, lon: lastPos.lon, vel: 0, acc: 0, status: "stopped" });
        console.log("🛑 Stopped at:", lastPos);
      } catch (err) {
        console.error("Failed to send stop signal:", err);
      }
    } else {
      console.warn("⚠️ stopTracking called with no last known position");
    }
    prevSpeedRef.current    = 0;
    prevTimeRef.current     = Date.now();
    lastPosRef.current      = null;
    lastSendTimeRef.current = 0;
  };

  
  // 7. TIMER FOR LAST SEEN.
  useEffect(() => {
    if (!isTracking) return;
    const timer = setInterval(() => setLastSent(p => p !== null ? p + 1 : null), 1000);
    return () => clearInterval(timer);
  }, [isTracking]);

 
  // 8. CLEANUP ON UNMOUNT.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (sendTimerRef.current) clearInterval(sendTimerRef.current);
      if (intervalRef.current)  clearInterval(intervalRef.current);
    };
  }, []);

  return { isTracking, busStatus, startTracking, stopTracking, lastSent, error };
};