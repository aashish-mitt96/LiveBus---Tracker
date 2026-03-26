import { Request, Response } from "express";
import { db } from '../database/dbConnection';
import { trip } from '../database/schema/trip.schema';

export const searchBuses = async (req: Request, res: Response) => {
  try {
    const { source, destination } = req.query;

    if (typeof source !== "string" || typeof destination !== "string") {
      return res.status(400).json({ error: "Invalid query params" });
    }

    const s = source.trim().toLowerCase();
    const d = destination.trim().toLowerCase();
    if (s === d) return res.status(400).json({ error: "Source & Destination cannot be same." });

    // Fetch only required Fields
    const buses = await db.select({
      tripId: trip.tripId,
      bus_number: trip.bus_number,
      route: trip.route,
      status: trip.status,
    }).from(trip);

    const filtered = buses.filter((b) => {
      const route  = Array.isArray(b.route) ? b.route.map((r: string) => r.toLowerCase()) : [];
      const sIndex = route.indexOf(s);
      const dIndex = route.indexOf(d);
      return sIndex !== -1 && dIndex !== -1 && sIndex < dIndex;
    });

    // Filter Active Bus First.
    filtered.sort((a, b) =>
      (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0)
    );
    return res.status(200).json(filtered);

  } catch (err) {
    console.error("Search Bus Controller error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};