import OpenAI from "openai";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// A limiter is configured but never invoked on this route. This is the common
// AI-built failure (DryRun): the limiter is present in the repo but not wired to
// the endpoint, so it provides no protection here. Must be flagged.
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: completion.choices[0]?.message?.content ?? "" });
}
