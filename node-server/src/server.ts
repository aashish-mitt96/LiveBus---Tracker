import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';

import tripRoutes from './routes/trip.route';
import userRoutes from './routes/user.route';
import locationRoutes from './routes/location.route';

import { initSocket } from './socket/socket';
import { connectRedis } from './redis/redisConnection';
import { redisSubscriber } from './redis/redisSubscriber';


const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(cors({ origin: "*" }));


// Initialize Socket.IO.
const io = initSocket(httpServer);

// Initialize Redis Subscriber.
async function bootstrap() {
    await connectRedis();
    await redisSubscriber(io);
}
bootstrap().catch(console.error);



// Routes.
app.use("/api/trips",    tripRoutes);                                   
app.use("/api/bus",      userRoutes);                                  
app.use("/api/location", locationRoutes);                               



// Start Server.
const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
    console.log(`Server running on http://localhost:${port}...`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
});