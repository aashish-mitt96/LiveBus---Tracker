import { Request, Response } from "express";
import { bufferStop } from "../services/stops.service";


// Buffer a Stop Pinged Mid-Trip (no DB write until trip ends).
export async function pinStop(req: Request, res: Response): Promise<void> {
    try {
        const { tripId }   = req.params;
        const { lat, lng } = req.body;

        console.log(`[pin_stop] received: tripId=${tripId}, lat=${lat}, lng=${lng}`);
        if (lat === undefined || lng === undefined) {
            res.status(400).json({ error: "lat and lng are required" });
            return;
        }
        const stop_name = await bufferStop(tripId as string, lat, lng);

        res.status(200).json({
            buffered: true,
            lat,
            lng,
            stop_name,
            message: "Stop buffered. Will be written to DB when trip ends.",
        });

    } catch (err) {
        console.error("❌ pinStop error:", err);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
}