import express from "express";
import { liveLocation } from "../controllers/location.controller";

const router = express.Router();


router.post("/live", liveLocation);

export default router;