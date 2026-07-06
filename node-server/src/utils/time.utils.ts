const TIMEZONE = process.env.TIMEZONE || "Asia/Kolkata";


// Convert a Timestamp into local Minute-of-Day and Day-of-Week.
export function localTimeParts(ts: number): { minuteOfDay: number; dayOfWeek: number } {

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12:   false,
    hour:    "2-digit",
    minute:  "2-digit",
    weekday: "short",
  });
  
  const parts  = fmt.formatToParts(new Date(ts));
  const get    = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour   = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);

  const weekdayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { minuteOfDay: hour * 60 + minute, dayOfWeek: weekdayMap[get("weekday")] ?? 0 };
}