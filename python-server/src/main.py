import os
import threading
from src import create_app, db
from src.database.models import Trip
from src.redis.redisSubscribe import subscribe_to_redis

app = create_app()

# For Dev: Create Tables.
with app.app_context():
    db.create_all()

# Run Redis Subscriber.
def start_redis_listener():
    subscribe_to_redis()

t = threading.Thread(target=start_redis_listener)
t.daemon = True 
t.start()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)