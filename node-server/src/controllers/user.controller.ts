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

    if (s === d) {
      return res.status(400).json({ error: "Source and Destination cannot be same." });
    }

    const buses = await db.select({
      tripId: trip.tripId,
      bus_number: trip.bus_number,
      source: trip.source,
      destination: trip.destination,
      route: trip.route,
      status: trip.status,
    }).from(trip);

    const filtered = buses.filter((b) => {
      return (
        b.source.toLowerCase() === s &&
        b.destination.toLowerCase() === d
      );
    });

    // Sort active buses first
    filtered.sort((a, b) =>
      (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0)
    );

    return res.status(200).json(filtered);

  } catch (err) {
    console.error("searchBuses error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};