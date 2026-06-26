import OpenAI from "openai";

const openai = new OpenAI();

export const generate = async (req, res) => {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(req.body.goal) }],
  });
  res.json({ plan: c.choices[0]?.message?.content ?? "" });
};
