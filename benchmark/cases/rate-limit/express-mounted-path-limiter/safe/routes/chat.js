const express = require("express");
const OpenAI = require("openai");
const router = express.Router();
const openai = new OpenAI();
router.post("/", async (req, res) => {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.prompt) }],
  });
  res.json({ text: c.choices[0]?.message?.content ?? "" });
});
module.exports = router;
