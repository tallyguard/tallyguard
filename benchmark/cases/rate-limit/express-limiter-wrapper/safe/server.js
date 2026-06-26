import express from "express";
import OpenAI from "openai";
import limiter from "./utils/limiter.js";

const app = express();
const openai = new OpenAI();

// SAFE: the limiter is a local wrapper around express-rate-limit, applied at the route.
app.post("/chat", limiter, async (req, res) => {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: c.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
