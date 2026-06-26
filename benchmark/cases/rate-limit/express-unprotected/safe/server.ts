import express from "express";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const limiter = rateLimit({ windowMs: 60_000, max: 10 });

// SAFE: a rate limiter is applied to this route.
app.post("/chat", limiter, async (req, res) => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: completion.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
