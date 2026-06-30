import { redisClient } from '../redis/redisConnection'
import { Request, Response } from "express";

// Push location to Redis
export const liveLocation = async (req: Request, res: Response) => {
    const { tripId, lat, lon, vel, acc ,status} = req.body;

    if (!tripId || lat === undefined || lon === undefined) {
        return res.status(400).json({ message: "Invalid data" });
    }

    try {
        // Create raw data object
        const rawData = {
            tripId,
            lat,
            lon,
            vel: vel ?? null,   // optional
            acc: acc ?? null,   // optional
            timestamp: Date.now(),
            status: status ?? "moving", // default to "moving" if not provided
        };

        // Publish to Redis channel 'raw_location'
        await redisClient.publish('raw_location', JSON.stringify(rawData));

        return res.json({ message: "Raw data published to Redis", data: rawData });
    } catch (err) {
        console.error('Redis error:', err);
        return res.status(500).json({ message: "Redis error" });
    }
};