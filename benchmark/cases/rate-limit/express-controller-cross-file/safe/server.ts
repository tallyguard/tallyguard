import express from "express";
import rateLimit from "express-rate-limit";
import { authController } from "./controllers/auth";

const app = express();
const limiter = rateLimit({ windowMs: 60_000, max: 5 });

// SAFE: the cross-file controller login is rate-limited.
app.post("/login", limiter, authController.login);

app.listen(3000);
