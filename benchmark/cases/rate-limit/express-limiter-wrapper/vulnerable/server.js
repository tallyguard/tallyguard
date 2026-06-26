import express from "express";
import OpenAI from "openai";
import logger from "./utils/logger.js";

const app = express();
const openai = new OpenAI();

// VULNERABLE: the only middleware is a local logger (not a limiter); the route is unprotected.
app.post("/chat", logger, async (req, res) => {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: c.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
