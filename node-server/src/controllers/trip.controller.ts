import { eq } from "drizzle-orm";
import { Request, Response } from "express";

import { db } from "../database/dbConnection";
import { trip } from "../database/schema/trip.schema";


// Start a Bus Trip.
export async function startTrip(req: Request, res: Response): Promise<void> {
    try {

        console.log("🚀 START TRIP CONTROLLER HIT");
        const { bus_number, source, destination } = req.body;

        if (!bus_number || !source || !destination) {
            res.status(400).json({ success: false, message: "All fields are required." });
            return;
        }

        const route = JSON.stringify([source, destination]);

        console.log("TYPE:", typeof route);
        console.log("IS ARRAY:", Array.isArray(route));
        console.log("VALUE:", route);

        console.log("FINAL INSERT DATA:", {
            bus_number,
            source,
            destination,
            route: [source, destination],
        });

        const [newTrip] = await db
            .insert(trip)
            .values({
                bus_number,
                source,
                destination,
                route: route as any,
            })
            .returning();

        res.status(201).json({
            success: true,
            message: "Trip created successfully.",
            tripId: newTrip.tripId,
            data: newTrip,
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Internal server error" });
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
        if (!existingTrip) {
            res.status(404).json({ success: false, message: "Trip not found." });
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