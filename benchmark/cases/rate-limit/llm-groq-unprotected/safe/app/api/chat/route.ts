import Groq from "groq-sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const groq = new Groq();
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

// SAFE: the Groq route enforces an @upstash/ratelimit limit before calling the model.
export async function POST(req: Request) {
  const { success } = await ratelimit.limit("chat");
  if (!success) return new Response("Too Many Requests", { status: 429 });

  const { prompt } = await req.json();
  const c = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
}
