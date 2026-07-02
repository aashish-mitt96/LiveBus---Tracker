import express from 'express';
import { startTrip, endTrip } from '../controllers/trip.controller';
import { pinStop } from '../controllers/stops.controller';

const router = express.Router();


router.post ('/start-trip',       startTrip);
router.patch("/end-trip/:tripId", endTrip);
router.post ("/:tripId/pin-stop", pinStop);

export default router;