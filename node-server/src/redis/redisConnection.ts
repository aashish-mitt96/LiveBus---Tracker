import { createClient, RedisClientType } from 'redis';


// Create and Export Redis Client.
export const redisClient: RedisClientType = createClient({
    username: 'default', 
    password: process.env.REDIS_PASSWORD, 
    socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT) || 6379
    }
});
redisClient.on('error', (err) => console.error('Redis Client Error', err));


// Connect to Redis.
export const connectRedis = async (): Promise<void> => {
    try {
        await redisClient.connect();
        console.log('Connected to Redis Cloud.');
    } catch (err) {
        console.error('Redis connection failed.', err);
    }
};