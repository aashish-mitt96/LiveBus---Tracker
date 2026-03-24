import express from 'express';
import { startTrip, endTrip } from '../controllers/trip.controller';

const router = express.Router();


router.post ('/start-trip', startTrip);
router.patch("/end-trip/:tripId", endTrip);

export default router;