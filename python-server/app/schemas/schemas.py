from pydantic import BaseModel



# Response Returned after Predicting the Bus Location.
class PredictionResponse(BaseModel):
    lat:                    float
    lon:                    float
    velocity:               float
    accuracy_radius_m:      float
    seconds_since_real_fix: float
    is_predicted:           bool



# Single Speed Sample used for Model Training.
class SpeedSampleIn(BaseModel):
    route_id:            str
    progress_fraction:   float
    minute_of_day:       float
    day_of_week:         int
    speed_mps:           float



# Request Body for Training the Speed Prediction Model.
class TrainRequest(BaseModel):
    samples: list[SpeedSampleIn]