import { Server } from "socket.io";
import { redisClient } from "./redisConnection";


// Initialize Redis Subscriber & Bind it to Socket.IO.
export async function redisSubscriber(io: Server) {
    const subscriber = redisClient.duplicate();
    await subscriber.connect();
    console.log("Subscribed to processed_data channel.");

    await subscriber.subscribe("processed_data", async (message) => {
        try {
            const processedData = JSON.parse(message);
            console.log("Processed data received:", processedData);
            const { tripId } = processedData;

            if (tripId) {
                // 1. Store Latest Location in Redis.
                await redisClient.set(`lastLocation:${tripId}`, JSON.stringify(processedData), { EX: 7200 });

                // 2. Emit to Socket Room.
                io.to(tripId).emit("locationUpdate", processedData);
                console.log(`Emitting update for tripId ${tripId}`);
            }
        } catch (err) {
            console.error("Error Processing Redis message:", err);
        }
    });
}