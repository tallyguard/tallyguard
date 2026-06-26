import rateLimit from "express-rate-limit";

const limiter = rateLimit({ windowMs: 60_000, max: 100 });

export default limiter;
