import { Request, Response } from "express";
import { redisClient } from "../redis/redisConnection";


// Receive Live GPS Data and Publish it to Redis.
export const liveLocation = async (req: Request, res: Response) => {

    const { tripId, lat, lon, vel, acc, status } = req.body;
    if (!tripId || lat === undefined || lon === undefined) {
        return res.status(400).json({ message: "Invalid data" });
    }

    try {
        // Create Location Payload.
        const rawData = {
            tripId:    tripId,
            lat:       lat,
            lon:       lon,
            vel:       vel ?? null,         
            acc:       acc ?? null,                
            timestamp: Date.now(),             
            status:    status ?? "moving",       
        };

        // Publish Location to Redis Channel.
        await redisClient.publish("raw_location", JSON.stringify(rawData));
        return res.json({
            message: "Raw data published to Redis",
            data: rawData,
        });
        
    } catch (err) {
        console.error("Redis error:", err);
        return res.status(500).json({ message: "Redis error" });
    }
};