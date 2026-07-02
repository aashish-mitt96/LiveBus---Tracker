import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { initSocket } from './socket/socket';
import userRoutes from './routes/user.route';
import tripRoutes from './routes/trip.route';
import redisRoutes from './routes/location.route';
import { connectRedis } from './redis/redisConnection';
import { initRedisSubscriber } from './redis/redisSubscriber';
import { initRawLocationSubscriber } from './redis/redisLocation';


const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json());

initSocket(httpServer);

app.use("/api/trips",    tripRoutes);
app.use("/api/location", redisRoutes);
app.use("/api/bus",      userRoutes);


const port = process.env.PORT || 4000;
async function bootstrap() {
    await connectRedis();
    await initRedisSubscriber();
    await initRawLocationSubscriber();

    httpServer.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
        console.log(`Environment: ${process.env.NODE_ENV}`);
    });
}
bootstrap().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});