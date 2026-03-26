import os
import redis
from dotenv import load_dotenv

load_dotenv()  

# Create Redis Connection Client.
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    password=os.getenv("REDIS_PASSWORD"),
    decode_responses=True  
)