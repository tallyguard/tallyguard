import OpenAI from "openai";
import { withAuth } from "../../../lib/with-auth";

const openai = new OpenAI();

// VULNERABLE: withAuth only checks auth; no rate limiter is reachable.
export const POST = withAuth(async (req: Request) => {
  const { prompt } = await req.json();
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
});
