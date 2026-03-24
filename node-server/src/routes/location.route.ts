import express from "express";
import { liveLocation } from "../controllers/location.comtroller";

const router = express.Router();


router.post("/location", liveLocation);

export default router;