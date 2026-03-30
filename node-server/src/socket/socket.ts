import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { redisClient } from '../redis/redisConnection';


// Initialize Socket.IO Server.
export function initSocket(httpServer: HttpServer) {
    const io = new Server(httpServer, {
        cors: { origin: "*",  methods: ["GET", "POST"] },
    });

    // Handle Socket.IO Connections.
    io.on("connection", (socket) => {
        console.log(`Client connected: ${socket.id}`);

        // 1. Requests to Track a Bus.
        socket.on("trackBus", async (tripId: string) => {
            socket.join(tripId);
            try {
                const cached = await redisClient.get(`lastLocation:${tripId}`);
                if (cached) {
                    const lastLocation = JSON.parse(cached as string);
                    console.log(`Sending cached location to late joiner for tripId: ${tripId}`);
                    socket.emit("lastKnownLocation", lastLocation);
                }
            } catch (err) {
                console.error("Redis fetch error:", err);
            }
        });

        // 2. Requests to Stop Tracking a Bus.
        socket.on("stopTrackBus", (tripId: string) => {
            console.log(`Socket ${socket.id} leaving room: ${tripId}`);
            socket.leave(tripId);
        });

        // 3. Handle Disconnections.
        socket.on("disconnect", () => {
            console.log(`Client disconnected: ${socket.id}`);
        });
    })
    return io;
}