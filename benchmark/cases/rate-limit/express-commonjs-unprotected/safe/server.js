const express = require("express");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const app = express();
const openai = new OpenAI();
const limiter = rateLimit({ windowMs: 60000, max: 10 });

// SAFE: route-level limiter via a CommonJS require.
app.post("/chat", limiter, async (req, res) => {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: c.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
