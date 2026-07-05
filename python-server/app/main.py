from fastapi import BackgroundTasks, FastAPI

from .core.predictor import predict
from .core.trainer import model_status, model_train
from .schemas.schemas import (
    ModelStatusResponse,
    PredictRequest,
    PredictResponse,
    TrainRequest,
    TrainResponse,
)


app = FastAPI(title="No Network Zone Route Predictor", version="2.0.0")


# Health Check Endpoint.
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/model/train", response_model=TrainResponse)
def train(req: TrainRequest, background_tasks: BackgroundTasks):
    return model_train(req, background_tasks)


@app.get("/model/status/{route_id}", response_model=ModelStatusResponse)
def train_status(route_id: str):
    return model_status(route_id)


@app.post("/predict", response_model=PredictResponse)
def predict_location(req: PredictRequest):
    return predict(req)