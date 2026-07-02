import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../database/dbConnection";
import { trip } from "../database/schema/trip.schema";
import { flushStopsToRoute } from "../services/stops.service";
import { route, routeStop } from "../database/schema/route.schema";
import { findOrCreateRoute, addStopToRoute, refineDestinationCoords } from "../services/route.service";
import { clearTripWindow } from "../redis/redisLocation";
import { sendTrainingSamples } from "../services/training.service";


// 1. Start a new trip for a bus.
export async function startTrip(req: Request, res: Response): Promise<void> {
  try {
    const { bus_number, source, destination, lat, lng } = req.body;
    if (!bus_number || !source || !destination || lat === undefined || lng === undefined) {
      res.status(400).json({ success: false, message: "bus_number, source, destination, lat, and lng are required." });
      return;
    }

    // Normalize source and destination names.
    const s = source.trim().toLowerCase();
    const d = destination.trim().toLowerCase();

    // Find an existing route or create a new one.
    const { routeRow, isNew } = await findOrCreateRoute(bus_number, s, d);

    // Seed terminal stops only when the route is created for the first time.
    if (isNew) {
      await db.insert(routeStop).values([
        { routeId: routeRow.routeId, seq: 0, stopName: s, lat, lng, isTerminal: true, sampleCount: 1 },
        { routeId: routeRow.routeId, seq: 1, stopName: d, lat, lng, isTerminal: true, sampleCount: 0 },
      ]);
    }

    // Create a new trip instance for this route.
    const [newTrip] = await db
      .insert(trip)
      .values({ routeId: routeRow.routeId, status: "active" })
      .returning();

    res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew ? "New route + trip created." : "Existing route reused — prior stops carried over.",
      tripId: newTrip.tripId,
      routeId: routeRow.routeId,
      data: newTrip,
    });
  } catch (err) {
    console.error("❌ startTrip error:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
}



// 2. Add a new stop to an Active Trip.
export async function updateRoute(req: Request, res: Response): Promise<void> {
  try {
    const { tripId } = req.params;
    const { lat, lng, stop_name } = req.body;
    if (lat === undefined || lng === undefined) {
      res.status(400).json({ success: false, message: "lat and lng are required." });
      return;
    }

    // Allow internal requests even after trip completion.
    const isInternal = req.headers["x-internal"] === "true";

    // Fetch trip details.
    const [existingTrip] = await db.select().from(trip).where(eq(trip.tripId, tripId as string));
    if (!existingTrip) {
      res.status(404).json({ success: false, message: "Trip not found." });
      return;
    }

    // Prevent external updates after trip completion.
    if (existingTrip.status === "completed" && !isInternal) {
      res.status(400).json({ success: false, message: "Cannot update route of a completed trip." });
      return;
    }

    // Insert or merge the stop into the route.
    const result = await addStopToRoute(existingTrip.routeId, {
      lat,
      lng,
      stop_name: stop_name || "Unknown",
    });

    res.status(200).json({
      success: true,
      skipped: result.skipped,
      stops: result.stops,
    });
  } catch (err) {
    console.error("❌ updateRoute error:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
}



// 3. End an Active Trip.
export async function endTrip(req: Request, res: Response): Promise<void> {
  try {
    const { tripId }   = req.params;
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      res.status(400).json({ success: false, message: "lat and lng are required." });
      return;
    }

    // Fetch trip details.
    const [existingTrip] = await db.select().from(trip).where(eq(trip.tripId, tripId as string));
    if (!existingTrip) {
      res.status(404).json({ success: false, message: "Bus trip not found." });
      return;
    }

    // Prevent ending an already completed trip.
    if (existingTrip.status === "completed") {
      res.status(400).json({ success: false, message: "Trip already ended." });
      return;
    }

    // Mark the trip as completed.
    const [updatedTrip] = await db
      .update(trip)
      .set({
        status:   "completed",
        endedAt:   new Date(),
        updatedAt: new Date(),
      })
      .where(eq(trip.tripId, tripId as string))
      .returning();

    // Update destination coordinates.
    await refineDestinationCoords(existingTrip.routeId, lat, lng);

    // Flush buffered stops asynchronously.
    flushStopsToRoute(tripId as string).catch(err =>
      console.error("❌ Stop flushing failed:", err)
    );

    // Forward this trip's location history to the predictor service so its
    // historical speed model can learn from it (fire-and-forget).
    sendTrainingSamples(tripId as string, existingTrip.routeId);

    // Release in-memory map-matching state now that this trip is done.
    clearTripWindow(tripId as string);

    res.status(200).json({
      success:  true,
      message: "Trip ended successfully.",
      data:     updatedTrip,
    });
  } catch (err) {
    console.error("❌ endTrip error:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
}



// 4. Get all Stops of a Trip.
export async function getStops(req: Request, res: Response): Promise<void> {
  try {
    const { tripId } = req.params;

    // Fetch trip details.
    const [existingTrip] = await db.select().from(trip).where(eq(trip.tripId, tripId as string));
    if (!existingTrip) {
      res.status(404).json({ success: false, message: "Trip not found." });
      return;
    }

    // Fetch route and its stops.
    const [routeRow] = await db.select().from(route).where(eq(route.routeId, existingTrip.routeId));
    const stops      = await db.select().from(routeStop).where(eq(routeStop.routeId, existingTrip.routeId));

    res.status(200).json({
      success:     true,
      bus_number:  routeRow.bus_number,
      source:      routeRow.source,
      destination: routeRow.destination,
      stops:       stops.map((stop, idx) => ({ idx, stop })),
    });
  } catch (err) {
    console.error("❌ getStops error:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
}