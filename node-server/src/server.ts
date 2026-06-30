import express from 'express';
import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import tripRoutes from './routes/trip.route';
import redisRoutes from './routes/location.route';
import userRoutes from './routes/user.route';
import { connectRedis, redisClient } from './redis/redisConnection';
import cors from 'cors'

const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: "*" }));

export const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // User wants to track a specific bus
    socket.on("trackBus", async (tripId: string) => {
        socket.join(tripId);

        try {
            const cached = await redisClient.get(`lastLocation:${tripId}`);
            if (cached) {
                const lastLocation = JSON.parse(cached as any);
                console.log(`📦 Sending cached location to late joiner for tripId: ${tripId}`);
                // ✅ Different event name so client can handle it separately
                socket.emit("lastKnownLocation", lastLocation);
            }
        } catch (err) {
            console.error("Failed to fetch cached location from Redis:", err);
        }
    });

    socket.on("stopTrackBus", (tripId: string) => {
        console.log(`🚪 Socket ${socket.id} leaving room: ${tripId}`);
        socket.leave(tripId);
    });

    socket.on("disconnect", () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
    });
});

const port = process.env.PORT || 4000;

app.use(express.json());

async function initRedis() {
    await connectRedis();

    const subscriber = redisClient.duplicate();
    await subscriber.connect();

    console.log("🔔 Subscribed to processed_data channel...");

    await subscriber.subscribe("processed_data", async (message) => {
        const processedData = JSON.parse(message);
        console.log("✅ Processed data received:", processedData);

        const { tripId } = processedData;

        if (tripId) {
            // ✅ Cache the latest location in Redis (expires in 2 hours)
            await redisClient.set(
                `lastLocation:${tripId}`,
                JSON.stringify(processedData),
                { EX: 7200 }
            );

            // Broadcast to all active users in the room
            io.to(tripId).emit("locationUpdate", processedData);
            console.log(`📡 Emitting update for tripId ${tripId} to room`);
        }
    });
}

initRedis().catch(console.error);

app.use("/api/location", redisRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/bus", userRoutes);

httpServer.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
});