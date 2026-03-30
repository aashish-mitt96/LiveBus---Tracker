import { redisClient } from '../redis/redisConnection'
import { Request, Response } from "express";


export const liveLocation = async (req: Request, res: Response) => {
    const { tripId, lat, lon, vel, acc } = req.body;
    if (!tripId || lat === undefined || lon === undefined) {
        return res.status(400).json({ message: "Invalid data" });
    }
    try {
        const rawData = { 
            tripId, lat, lon, vel: vel ?? null, acc: acc ?? null,  timestamp: Date.now(), status: status ?? "moving" 
        };

        // Publish data to Redis Channel.
        await redisClient.publish('raw_location', JSON.stringify(rawData));
        return res.json({
            message: "Raw Data Published to Redis.",
            data: rawData
        });
        
    } catch (err) {
        console.error('Redis error...', err);
        return res.status(500).json({
            message: "Redis error"
        });
    }
};