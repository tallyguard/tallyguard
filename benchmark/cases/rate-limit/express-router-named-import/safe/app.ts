import express from "express";
import rateLimit from "express-rate-limit";
import workoutRoutes from "./routes/workout";

const app = express();

// SAFE: a no-path global limiter covers every route on every mounted router.
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.use("/api/workouts", workoutRoutes);

app.listen(3000);
