import { Router } from "express";
import { generate } from "../controllers/workout";

// Named `Router` import (not express.Router()); the router is mounted in app.ts.
const router = Router();

router.post("/generate", generate);

export default router;
