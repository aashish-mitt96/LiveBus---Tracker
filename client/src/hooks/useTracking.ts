import { useEffect, useRef, useState } from "react";
import { sendLocation } from "../apis/trip.api";
import { DEMO_ROUTE, USE_DEMO } from "../constants/demoRoute";



export const useTracking = (tripId: string | null) => {

  const [isTracking, setIsTracking]     = useState(false);
  const [busStatus, setBusStatus]       = useState<"idle" | "moving" | "stopped">("idle");
  const [lastSent, setLastSent]         = useState<number | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<{
    lat: number; lon: number; vel: number; acc: number; time: string
  } | null>(null);

  const watchIdRef       = useRef<number | null>(null);
  const intervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSendingRef     = useRef<boolean>(false);
  const isTrackingRef    = useRef<boolean>(false);
  const lastPosRef       = useRef<{ lat: number; lon: number; vel: number; acc: number } | null>(null);
  const prevSpeedRef     = useRef<number>(0);
  const prevTimeRef      = useRef<number>(Date.now());
  const lastSendTimeRef  = useRef<number>(0);
  const routeIdxRef      = useRef<number>(0);
  const dwellCountRef    = useRef<number>(0);
  const firstPingRef     = useRef<boolean>(true); 


  // 1. Helper function to Pin a Stop on the Server.
  const pinStop = (lat: number, lng: number) => {
    if (!tripId) return;
    fetch(`${import.meta.env.VITE_PYTHON_BACKEND_URL}/api/trips/${tripId}/pin-stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    }).catch(console.error);
  };


  // 2. Send Location Ping to the Server.
  const sendPing = async (
    latitude: number, longitude: number,
    velocity: number, acceleration: number,
    status: "moving" | "stopped"
  ) => {
    if (!tripId || isSendingRef.current) return;
    try {
      isSendingRef.current = true;
      lastPosRef.current = { lat: latitude, lon: longitude, vel: velocity, acc: acceleration };
      const pingTime = new Date().toLocaleTimeString();
      console.log("📍 LOCATION UPDATE:", { lat: latitude, lon: longitude, vel: velocity, acc: acceleration, time: pingTime });
      await sendLocation({ tripId, lat: latitude, lon: longitude, vel: velocity, acc: acceleration, status });
      setLastSent(0);
      setLastLocation({ lat: latitude, lon: longitude, vel: velocity, acc: acceleration, time: pingTime });
      setError(null);
    } catch (err) {
      console.error("Send error:", err);
      setError("Failed to send location");
    } finally {
      isSendingRef.current = false;
    }
  };


  // 3. Fallback timer to send location every 10s if GPS is lost or delayed.
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


  // 4. Demo mode ticker to simulate movement along a predefined route.
  const startDemoTicker = () => {
    if (sendTimerRef.current) clearInterval(sendTimerRef.current);
    sendTimerRef.current = setInterval(async () => {
      if (!isTrackingRef.current || isSendingRef.current) return;
      const idx = routeIdxRef.current;
      if (idx >= DEMO_ROUTE.length) {
        console.log("🏁 Demo route complete");
        stopTracking();
        return;
      }
      const [lat, lon, dwellPings] = DEMO_ROUTE[idx];
      const prevLat = lastPosRef.current?.lat ?? lat;
      const prevLon = lastPosRef.current?.lon ?? lon;
      const dLat = lat - prevLat;
      const dLon = lon - prevLon;
      const distMetres = Math.sqrt(dLat * dLat + dLon * dLon) * 111_320;
      const velocity = distMetres / 10; 
      lastSendTimeRef.current = Date.now();
      setBusStatus("moving");
      await sendPing(lat, lon, velocity, 0, "moving");
      if (dwellPings > 0) {
        dwellCountRef.current += 1;
        console.log(`⏳ Dwelling at idx=${idx} (${dwellCountRef.current}/${dwellPings})`);
        if (dwellCountRef.current >= dwellPings) {
          console.log(`📍 Dwell complete at idx=${idx} — pinning stop`);
          pinStop(lat, lon); 
          dwellCountRef.current = 0;
          routeIdxRef.current += 1;
        }
      } else {
        routeIdxRef.current += 1;
      }
    }, 10_000); 
  };


  // 5. Attach Geolocation Watch to track real-time GPS updates.
  const attachWatch = () => {
    if (!navigator.geolocation) { setError("Geolocation not supported"); return; }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed } = pos.coords;
        const velocity     = speed !== null && speed !== undefined ? speed : prevSpeedRef.current;
        const now          = Date.now();
        const deltaTime    = (now - prevTimeRef.current) / 1000;
        const acceleration = deltaTime > 0 ? (velocity - prevSpeedRef.current) / deltaTime : 0;
        prevSpeedRef.current  = velocity;
        prevTimeRef.current   = now;
        lastPosRef.current    = { lat: latitude, lon: longitude, vel: velocity, acc: acceleration };
        setError(null);

        const nowTime = Date.now();
        if (isTrackingRef.current && nowTime - lastSendTimeRef.current >= 10_000 && !isSendingRef.current) {
          lastSendTimeRef.current = nowTime;
          setBusStatus("moving");
          sendPing(latitude, longitude, velocity, acceleration, "moving");

          // ✅ Auto-pin source on the very first real GPS fix.
          if (firstPingRef.current) {
            firstPingRef.current = false;
            console.log("📍 Auto-pinning source stop (first GPS fix)");
            pinStop(latitude, longitude);
          }
        }
      },
      (err) => {
        console.error("GPS error:", err);
        setError("GPS lost — tap START to resume");
        isTrackingRef.current = false;
        setIsTracking(false);
        setBusStatus("stopped");
        if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
        if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
    startSendTimer();
  };


  // 6. Handle Tab Visibility Changes to Restart Timers if Needed.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isTrackingRef.current) {
        console.log("👁 Tab visible — checking timers");
        if (sendTimerRef.current === null) {
          console.log("🔁 Restarting send timer");
          USE_DEMO ? startDemoTicker() : startSendTimer();
        }
        if (!USE_DEMO && watchIdRef.current === null) {
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


  // 7. Start Tracking: Initialize GPS tracking or demo mode.
  const startTracking = () => {
    if (!tripId) { setError("Trip not initialized"); return; }
    if (isTrackingRef.current) return;
    isTrackingRef.current  = true;
    lastSendTimeRef.current = Date.now();
    setIsTracking(true);
    setBusStatus("moving");
    setError(null);
    if (USE_DEMO) {
      const resumeIdx = routeIdxRef.current;
      if (resumeIdx >= DEMO_ROUTE.length) {
        console.warn("⚠️ Demo route already complete. End the trip to restart.");
        isTrackingRef.current = false;
        setIsTracking(false);
        setBusStatus("stopped");
        return;
      }
      const [lat, lon] = DEMO_ROUTE[resumeIdx];
      lastPosRef.current = { lat, lon, vel: 0, acc: 0 };
      sendPing(lat, lon, 0, 0, "moving");

      // ✅ Auto-pin the SOURCE stop immediately when tracking starts.
      if (firstPingRef.current) {
        firstPingRef.current = false;
        console.log("📍 Auto-pinning source stop (demo start)");
        pinStop(lat, lon);
      }
      routeIdxRef.current = resumeIdx + 1;
      startDemoTicker();
    } else {
      attachWatch();
    }
  };


  // 8. Stop Tracking: Clear GPS watch and timers, send final stop signal.
  const stopTracking = async () => {
    isTrackingRef.current = false;
    setIsTracking(false);
    setBusStatus("stopped");
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
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
    prevSpeedRef.current   = 0;
    prevTimeRef.current    = Date.now();
    lastSendTimeRef.current = 0;
  };


  // 9. Reset Trip: Clear all tracking state and prepare for a new trip.
  const resetTrip = () => {
    lastPosRef.current  = null;
    routeIdxRef.current = 0;
    dwellCountRef.current = 0;
    firstPingRef.current  = true;
    setLastLocation(null);
  };


  // 10. Update lastSent counter every second while tracking.
  useEffect(() => {
    if (!isTracking) return;
    const timer = setInterval(() => setLastSent(p => p !== null ? p + 1 : null), 1000);
    return () => clearInterval(timer);
  }, [isTracking]);


  // 11. Cleanup on unmount: Clear GPS watch and timers to prevent memory leaks.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (sendTimerRef.current) clearInterval(sendTimerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { isTracking, busStatus, startTracking, stopTracking, resetTrip, lastSent, error, lastLocation };
};