const express = require("express");

const app = express();

// VULNERABLE: a CommonJS router split across files, mounted with no rate limiting.
app.use("/api/auth", require("./routes/auth"));

app.listen(3000);
