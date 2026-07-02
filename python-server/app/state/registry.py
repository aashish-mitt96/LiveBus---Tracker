import asyncio
from typing import Optional

from ..models.predictor import TripPredictor


class PredictorRegistry:

    def __init__(self):
        self._predictors: dict[str, TripPredictor] = {}
        self._lock = asyncio.Lock()

    async def get(self, trip_id: str) -> Optional[TripPredictor]:
        async with self._lock:
            return self._predictors.get(trip_id)

    async def set(self, trip_id: str, predictor: TripPredictor):
        async with self._lock:
            self._predictors[trip_id] = predictor

    async def remove(self, trip_id: str):
        async with self._lock:
            self._predictors.pop(trip_id, None)

    async def all_trip_ids(self) -> list[str]:
        async with self._lock:
            return list(self._predictors.keys())


registry = PredictorRegistry()