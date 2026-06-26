const express = require("express");
const OpenAI = require("openai");

const app = express();
const openai = new OpenAI();

// VULNERABLE: a CommonJS Express LLM endpoint with no rate limit.
app.post("/chat", async (req, res) => {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: c.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
