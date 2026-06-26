const express = require("express");
const rateLimit = require("express-rate-limit");
const app = express();
// The /api limiter covers the chat router (mounted under /api) but NOT the auth router
// mounted at /auth, which is therefore unprotected and must be flagged.
app.use("/api", rateLimit({ windowMs: 60000, max: 100 }));
app.use("/api/chat", require("./routes/chat"));
app.use("/auth", require("./routes/auth"));
app.listen(3000);
