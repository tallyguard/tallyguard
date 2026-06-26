import OpenAI from "openai";
import { enforceLimit } from "../../../lib/limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// SAFE: the limiter is enforced inside a helper reached from the handler.
export async function POST(req: Request) {
  await enforceLimit(req.headers.get("x-forwarded-for") ?? "anonymous");
  const { prompt } = await req.json();
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
}
