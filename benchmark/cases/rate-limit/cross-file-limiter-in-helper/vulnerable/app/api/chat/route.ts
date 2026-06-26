import OpenAI from "openai";
import { logRequest } from "../../../lib/log";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// VULNERABLE: calls a helper, but it only logs; no limiter anywhere. Flag.
export async function POST(req: Request) {
  logRequest(req.headers.get("x-forwarded-for") ?? "anonymous");
  const { prompt } = await req.json();
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
}
