import { Router } from "express";
import { searchBuses } from "../controllers/user.controller";

const router = Router();

router.get("/search", searchBuses);

export default router;