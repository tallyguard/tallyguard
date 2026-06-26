import OpenAI from "openai";
import { withRateLimit } from "../../../lib/with-rate-limit";

const openai = new OpenAI();

// SAFE: the limiter is enforced inside the withRateLimit wrapper, not in this handler.
export const POST = withRateLimit(async (req: Request) => {
  const { prompt } = await req.json();
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
});
