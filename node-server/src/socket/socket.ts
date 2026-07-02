import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { redisClient } from '../redis/redisConnection';

export let io: Server;

export function initSocket(httpServer: HttpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        console.log(`🔌 Client connected: ${socket.id}`);

        // User wants to track a Specific Bus.
        socket.on("trackBus", async (tripId: string) => {
            socket.join(tripId);

            try {
                const cached = await redisClient.get(`lastLocation:${tripId}`);
                if (cached) {
                    const lastLocation = JSON.parse(cached as any);
                    console.log(`📦 Sending cached location to late joiner for tripId: ${tripId}`);
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
    
    return io;
}