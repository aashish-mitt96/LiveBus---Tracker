import { sql } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../database/dbConnection";



// Search Active buses between the Given Source & Destination.
export const searchBuses = async (req: Request, res: Response) => {
  try {
    const { source, destination } = req.query;

    if (typeof source !== "string" || typeof destination !== "string") {
      return res.status(400).json({ error: "Invalid query params" });
    }

    // Normalize input for case-insensitive matching.
    const s = `%${source.trim().toLowerCase()}%`;
    const d = `%${destination.trim().toLowerCase()}%`;

    // Prevent searching for the same stop.
    if (s === d) {
      return res.status(400).json({ error: "Source and Destination cannot be same." });
    }

    // Find trips where source appears before destination on the route.
    // Only the CURRENT run of a given bus_number/source/destination combo is
    // considered (t.current = true) — earlier completed runs on the same
    // route are intentionally excluded so they don't linger in search
    // results once a newer run has started. Currently-running (active)
    // buses are surfaced ahead of ones that have finished for the day.
    const result = await db.execute(sql`
      SELECT
        t."tripId"    AS "tripId",
        r."routeId"   AS "routeId",
        r.bus_number  AS bus_number,
        r.source      AS source,
        r.destination AS destination,
        t.status      AS status,
        s1.stop_name  AS board_at,
        s2.stop_name  AS alight_at,
        (s2.seq - s1.seq - 1) AS stops_between
      FROM route_stop s1
      JOIN route_stop s2 ON s1.route_id = s2.route_id AND s1.seq < s2.seq
      JOIN route r ON r."routeId" = s1.route_id
      JOIN trip t ON t.route_id = r."routeId"
      WHERE s1.stop_name ILIKE ${s}
        AND s2.stop_name ILIKE ${d}
        AND t.current = true
      ORDER BY (t.status = 'active') DESC, t.updated_at DESC
    `);

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("searchBuses error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};