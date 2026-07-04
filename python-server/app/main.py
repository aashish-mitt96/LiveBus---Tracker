from fastapi import FastAPI

from .core.predictor import predict
from .core.trainer import model_train
from .schemas.schemas import (
    PredictRequest,
    PredictResponse,
    TrainRequest,
    TrainResponse,
)


app = FastAPI(title="No Network Zone Route Predictor", version="1.0.0")


# Health Check Endpoint.
@app.get("/health")
def health():
    return {"status": "ok"}


# Train the Route Speed Model.
@app.post("/model/train", response_model=TrainResponse)
def train(req: TrainRequest):
    return model_train(req)


# Predict the Current Bus Location.
@app.post("/predict", response_model=PredictResponse)
def predict_location(req: PredictRequest):
    return predict(req)