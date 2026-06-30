# src/redis/redis_connection.py
import redis
import os
from dotenv import load_dotenv

load_dotenv()  # load .env variables

# Create a single Redis connection client
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    password=os.getenv("REDIS_PASSWORD"),
    decode_responses=True  # returns str instead of bytes
)