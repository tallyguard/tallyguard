import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

// SAFE: same raw LLM fetch, but rate-limited first.
export async function POST(req: Request) {
  const { success } = await ratelimit.limit("chat");
  if (!success) return new Response("Too Many Requests", { status: 429 });
  const { messages } = await req.json();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages }),
  });
  return Response.json(await r.json());
}
