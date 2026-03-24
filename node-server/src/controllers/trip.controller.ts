import { eq } from "drizzle-orm";
import { Request, Response } from "express";

import { db } from "../db/dbConnection";
import { trip } from "../db/schema/trip.schema";


// Start a Bus Trip.
export async function startTrip(req: Request, res: Response): Promise<void> {
    try {
        const { bus_number, source, destination } = req.body;
        if (!bus_number || !source || !destination) {
            res.status(400).json({ success: false, message: "All fields are required." });
            return;
        }

        const [newTrip] = await db.insert(trip).values({ bus_number, source, destination, route: [] }).returning();
        res.status(201).json({ success: true, message: "Trip created successfully.", tripId: newTrip.tripId,  data: newTrip });

    } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
            res.status(409).json({ success: false, message: "Bus Number already exists." });
            return;
        }
        console.error("Start Trip Controller error...", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}


// End a Bus Trip.
export async function endTrip(req: Request, res: Response): Promise<void> {
    try {
        const tripId = req.params.tripId as string;
        if (!tripId) {
            res.status(400).json({ success: false, message: "Trip ID is required." });
            return;
        }

        const [existingTrip] = await db.select().from(trip).where(eq(trip.tripId, tripId));
        if (!existingTrip) { res.status(404).json({ success: false, message: "Trip not found." });
            return;
        }
        if (existingTrip.status === "completed") {
            res.status(400).json({ success: false, message: "Trip already Ended." });
            return;
        }
        const [updatedTrip] = await db.update(trip)
            .set({ status: "completed", endedAt: new Date(), updatedAt: new Date() })
            .where(eq(trip.tripId, tripId))
            .returning();

        res.status(200).json({ success: true, message: "Trip ended successfully.", data: updatedTrip });

    } catch (err) {
        console.error("End Trip Controller error...", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}