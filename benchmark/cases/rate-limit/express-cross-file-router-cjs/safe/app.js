const express = require("express");
const rateLimit = require("express-rate-limit");

const app = express();

// SAFE: an app-wide limiter covers every route on every mounted router.
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.use("/api/auth", require("./routes/auth"));

app.listen(3000);
