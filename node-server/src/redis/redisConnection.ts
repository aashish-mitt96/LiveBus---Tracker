import { createClient, RedisClientType } from 'redis';

// Create and export the Redis client
export const redisClient: RedisClientType = createClient({
    username: 'default', // default for Redis Cloud
    password: process.env.REDIS_PASSWORD, // store in .env
    socket: {
        host: process.env.REDIS_HOST, // store in .env
        port: Number(process.env.REDIS_PORT) || 6379
    }
});

console.log('REDIS_HOST:', process.env.REDIS_HOST);
console.log('REDIS_PORT:', process.env.REDIS_PORT);

// Listen for errors
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Connect to Redis
export const connectRedis = async (): Promise<void> => {
    try {
        await redisClient.connect();
        console.log('✅ Connected to Redis Cloud');
    } catch (err) {
        console.error('❌ Redis connection failed:', err);
    }
};