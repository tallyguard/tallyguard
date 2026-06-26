const express = require("express");
const rateLimit = require("express-rate-limit");
const app = express();
// SAFE: a path-scoped limiter on /api covers every router mounted under /api,
// including the cross-file chat router below.
app.use("/api", rateLimit({ windowMs: 60000, max: 100 }));
app.use("/api/chat", require("./routes/chat"));
app.listen(3000);
