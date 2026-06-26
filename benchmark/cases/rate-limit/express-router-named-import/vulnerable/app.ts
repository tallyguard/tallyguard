import express from "express";
import workoutRoutes from "./routes/workout";

const app = express();

// VULNERABLE: a router with an AI route, mounted with no rate limiting.
app.use("/api/workouts", workoutRoutes);

app.listen(3000);
