import express from "express";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// A limiter is configured but never applied (not on the route, not via app.use). Must flag.
const limiter = rateLimit({ windowMs: 60_000, max: 10 });

app.post("/chat", async (req, res) => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: completion.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
