import { Server } from "socket.io";
import { redisClient } from "./redisConnection";


// Initialize Redis Subscriber and bind it to Socket.IO.
export const redisSubscriber = async (io: Server) => {
    const subscriber = redisClient.duplicate();
    await subscriber.connect();
    console.log("Subscribed to processed_data channel...");

    await subscriber.subscribe("processed_data", (message) => {
        const processedData = JSON.parse(message);
        const { tripId } = processedData;
        console.log("Processed data received... ", processedData);

        if (tripId) {
            io.to(tripId).emit("locationUpdate", processedData);
            console.log(`Emitted update to room... ${tripId}`);
        }
    });
};