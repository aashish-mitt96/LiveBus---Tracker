import { io } from '../socket/socket';
import { redisClient } from './redisConnection';


// Start Redis Subscriber for Processed Location Updates.
export async function initRedisSubscriber() {

    const subscriber = redisClient.duplicate();
    await subscriber.connect();

    // Listen for Processed Location Updates.
    await subscriber.subscribe("processed_data", (message) => {
        (async () => {
            try {
                const processedData = JSON.parse(message);
                const { tripId } = processedData;
                if (!tripId) return;

                await redisClient.set(`lastLocation:${tripId}`, JSON.stringify(processedData), { EX: 7200 });

                // Broadcast Update to all Clients.
                io.to(tripId).emit("locationUpdate", processedData);
            } catch (err) {
                console.error("[processed_data] malformed message, skipping:", err);
            }
        })();
    });

    return subscriber;
}