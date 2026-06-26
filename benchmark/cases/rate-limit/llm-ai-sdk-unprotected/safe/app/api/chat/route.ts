import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

// SAFE: the same AI SDK call, guarded by a limiter reachable on this route.
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const { success } = await ratelimit.limit(ip);
  if (!success) return new Response("Too Many Requests", { status: 429 });

  const { messages } = await req.json();
  const result = streamText({ model: openai("gpt-4o-mini"), messages });
  return result.toTextStreamResponse();
}
