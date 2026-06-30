import { Request, Response } from "express";
import { db } from "../database/dbConnection";
import { trip, Stop } from "../database/schema/trip.schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

// ── 1) Create Bus ─────────────────────────────────────────────────────────────
export async function startTrip(req: Request, res: Response): Promise<void> {
    try {
        const { bus_number, source, destination, lat, lng } = req.body; // ✅ added lat, lng

        if (!bus_number || !source || !destination || lat === undefined || lng === undefined) {
            res.status(400).json({
                success: false,
                message: "bus_number, source, destination, lat, and lng are required.",
            });
            return;
        }

        const s = source.trim().toLowerCase();
        const d = destination.trim().toLowerCase();

        // Check if same bus+route combo already exists
        const [existing] = await db
            .select()
            .from(trip)
            .where(
                and(
                    eq(trip.bus_number, bus_number),
                    eq(trip.source, s),
                    eq(trip.destination, d)
                )
            );

        if (existing) {
            // Reactivate with new tripId, reset route with new start coordinates
            const newTripId = createId();
            const [reactivated] = await db
                .update(trip)
                .set({
                    tripId: newTripId,
                    status: "active",
                    endedAt: null,
                    updatedAt: new Date(),
                    route: [
                        { lat, lng, stop_name: s }, // ✅ fresh source coords
                        { lat, lng, stop_name: d }, // ✅ destination placeholder
                    ],
                })
                .where(
                    and(
                        eq(trip.bus_number, bus_number),
                        eq(trip.source, s),
                        eq(trip.destination, d)
                    )
                )
                .returning();

            res.status(200).json({
                success: true,
                message: "Existing bus reactivated with previous route.",
                tripId: reactivated.tripId,
                data: reactivated,
            });
            return;
        }

        // First time — initialize route with source and destination
        const [newBus] = await db
            .insert(trip)
            .values({
                bus_number,
                source: s,
                destination: d,
                route: [
                    { lat, lng, stop_name: s }, // ✅ source with coordinates
                    { lat, lng, stop_name: d }, // ✅ destination placeholder
                ],
            })
            .returning();

        res.status(201).json({
            success: true,
            message: "Bus created successfully.",
            tripId: newBus.tripId,
            data: newBus,
        });

    } catch (err: unknown) {
        console.error("❌ createBus error:", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}


// ── 2) Update Route ───────────────────────────────────────────────────────────
export async function updateRoute(req: Request, res: Response): Promise<void> {
    console.log("[updateRoute] body received:", req.body);
    try {
        const { tripId } = req.params;
        const { lat, lng, stop_name } = req.body;

        if (lat === undefined || lng === undefined) {
            res.status(400).json({ success: false, message: "lat and lng are required." });
            return;
        }

        const [existing] = await db
            .select()
            .from(trip)
            .where(eq(trip.tripId, tripId as string));

        if (!existing) {
            res.status(404).json({ success: false, message: "Trip not found." });
            return;
        }

        const isInternal = req.headers['x-internal'] === 'true';

        if (existing.status === "completed" && !isInternal) {
            res.status(400).json({ success: false, message: "Cannot update route of a completed trip." });
            return;
        }

        const newStop: Stop = { lat, lng, stop_name: stop_name || "Unknown" };
        const currentRoute = Array.isArray(existing.route) ? existing.route as Stop[] : [];

        // Skip if last pinned stop (second to last, before destination) has same coordinates
        const lastPinned = currentRoute[currentRoute.length - 2];
        const skipped = lastPinned && lastPinned.lat === lat && lastPinned.lng === lng;

        if (skipped) {
            res.status(200).json({
                success: true,
                skipped: true,
                message: "Duplicate stop skipped.",
                route: currentRoute,
            });
            return;
        }

        // Insert before destination (last element)
        const destination = currentRoute[currentRoute.length - 1];
        const newRoute = destination
            ? [...currentRoute.slice(0, -1), newStop, destination]
            : [...currentRoute, newStop];

        const [updated] = await db
            .update(trip)
            .set({ route: newRoute, updatedAt: new Date() })
            .where(eq(trip.tripId, tripId as string))
            .returning();

        res.status(200).json({
            success: true,
            skipped: false,
            message: "Stop added to route.",
            route: updated.route,
        });

    } catch (err) {
        console.error("❌ updateRoute error:", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}


// ── 3) End Trip ───────────────────────────────────────────────────────────────
export async function endTrip(req: Request, res: Response): Promise<void> {
    try {
        const { tripId } = req.params;
        const { lat, lng } = req.body; // ✅ added lat, lng

        if (lat === undefined || lng === undefined) {
            res.status(400).json({ success: false, message: "lat and lng are required." });
            return;
        }

        const [existingTrip] = await db
            .select()
            .from(trip)
            .where(eq(trip.tripId, tripId as string));

        if (!existingTrip) {
            res.status(404).json({ success: false, message: "Bus trip not found." });
            return;
        }

        if (existingTrip.status === "completed") {
            res.status(400).json({ success: false, message: "Trip already ended." });
            return;
        }

        // ✅ Update destination (last stop) with actual ending coordinates
        const currentRoute = Array.isArray(existingTrip.route) ? existingTrip.route as Stop[] : [];
        const lastStop = currentRoute[currentRoute.length - 1];
        const updatedRoute: Stop[] = [
            ...currentRoute.slice(0, -1),
            { ...lastStop, lat, lng }, // ✅ update destination with real coords
        ];

        const [updatedBus] = await db
            .update(trip)
            .set({
                status: "completed",
                endedAt: new Date(),
                updatedAt: new Date(),
                route: updatedRoute, // ✅ save updated route
            })
            .where(eq(trip.tripId, tripId as string))
            .returning();

        // Fire-and-forget: notify Python service to process stops
        const PYTHON_URL = process.env.PYTHON_URL || "http://localhost:5000";
        fetch(`${PYTHON_URL}/internal/process-stops/${tripId}`, { method: "POST" })
            .catch(err => console.error("❌ Stop processing trigger failed:", err));

        res.status(200).json({
            success: true,
            message: "Trip ended successfully.",
            data: updatedBus,
        });

    } catch (err) {
        console.error("❌ endTrip error:", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}


// ── 4) Get Stops ──────────────────────────────────────────────────────────────
export async function getStops(req: Request, res: Response): Promise<void> {
    try {
        const { tripId } = req.params;

        const [existing] = await db
            .select()
            .from(trip)
            .where(eq(trip.tripId, tripId as string));

        if (!existing) {
            res.status(404).json({ success: false, message: "Trip not found." });
            return;
        }

        const route = Array.isArray(existing.route) ? existing.route as Stop[] : [];

        res.status(200).json({
            success: true,
            bus_number: existing.bus_number,
            source: existing.source,
            destination: existing.destination,
            stops: route.map((stop, idx) => ({ idx, stop })),
        });

    } catch (err) {
        console.error("❌ getStops error:", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}