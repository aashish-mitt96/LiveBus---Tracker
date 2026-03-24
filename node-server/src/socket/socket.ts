import { Server } from "socket.io";
import { Server as HTTPServer } from "http";


// Initialize Socket.IO Server.
export const initSocket = (httpServer: HTTPServer) => {

    // Create Socket.IO Instance. 
    const io = new Server(httpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] },
    });

    
    // Handle Client Connection.
    io.on("connection", (socket) => {
        console.log(`Client connected... ${socket.id}`);

        socket.on("trackBus", (tripId: string) => {
            socket.join(tripId);
            console.log(`Socket ${socket.id} joined room... ${tripId}`);
        });

        socket.on("stopTrackBus", (tripId: string) => {
            socket.leave(tripId);
            console.log(`Socket ${socket.id} left room... ${tripId}`);
        });

        socket.on("disconnect", () => {
            console.log(`Client disconnected... ${socket.id}`);
        });
    });
    return io;
};