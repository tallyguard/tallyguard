import express from "express";
import OpenAI from "openai";

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// VULNERABLE: an Express LLM endpoint with no rate limit.
app.post("/chat", async (req, res) => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: completion.choices[0]?.message?.content ?? "" });
});

app.listen(3000);
