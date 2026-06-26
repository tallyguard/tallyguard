import express from "express";
import { authController } from "./controllers/auth";

const app = express();

// VULNERABLE: handler is a controller method in another file (bcrypt.compare), no rate limit.
app.post("/login", authController.login);

app.listen(3000);
