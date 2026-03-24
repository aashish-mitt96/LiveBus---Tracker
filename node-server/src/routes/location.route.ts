import express from "express";
import { liveLocation } from "../controllers/location.controller";

const router = express.Router();


router.post("/location", liveLocation);

export default router;