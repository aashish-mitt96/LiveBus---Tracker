import json
from src.redis.redisConnection import redis_client


def publish_to_redis(data: dict):

    redis_client.publish("processed_data",json.dumps(data))
    # print("Processed data published:", data)
