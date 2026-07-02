import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from .connectors import database
from .schemas.schemas import PredictionResponse, TrainRequest
from .models.speed_model import SpeedSample
from .services.watcher import (
    _ensure_predictor,
    consume_real_fixes,
    publish_predictions_for_stale_trips,
    speed_model,
)

logging.basicConfig(level=logging.INFO)



# Manage Application Startup & Shutdown.
@asynccontextmanager
async def lifespan(app: FastAPI):

    await database.init_db_pool()
    # Start Background Services.
    consumer_task  = asyncio.create_task(consume_real_fixes())
    publisher_task = asyncio.create_task(publish_predictions_for_stale_trips())

    yield
    # Stop Background Services.
    consumer_task.cancel()
    publisher_task.cancel()
    await database.close_db_pool()


# Initialize FastAPI Application.
app = FastAPI(title="Bus Location Predictor", lifespan=lifespan)



# Health Check Endpoint.
@app.get("/health")
async def health():
    return {"status": "ok"}



# Predict the Current Location of a Trip.
@app.get("/trips/{trip_id}/predict", response_model=PredictionResponse)

async def predict_location(trip_id: str):
    # Get or Create the Trip Predictor.
    predictor = await _ensure_predictor(trip_id)
    if predictor is None:
        raise HTTPException(
            status_code=404,
            detail="Trip/route not found or has no stops yet",
        )

    # Generate the Latest Predicted Location.
    result = predictor.predict_now(time.time())
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No GPS fix received yet for this trip",
        )
    return result



# Train the Historical Speed Prediction Model.
@app.post("/model/train")

async def train_model(payload: TrainRequest):
    # Convert Request Data into Training Samples.
    samples = [
        SpeedSample(
            route_id=s.route_id,
            progress_fraction=s.progress_fraction,
            minute_of_day=s.minute_of_day,
            day_of_week=s.day_of_week,
            speed_mps=s.speed_mps,
        )
        for s in payload.samples
    ]

    # Train the Speed Model.
    speed_model.fit(samples)
    return {"trained_on": len(samples)}