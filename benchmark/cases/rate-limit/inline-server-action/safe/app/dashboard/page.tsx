import OpenAI from "openai";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

// SAFE: same inline server action, but it is rate-limited inside the action.
export default function Page() {
  async function generate(formData: FormData) {
    "use server";
    const { success } = await ratelimit.limit("anon");
    if (!success) throw new Error("rate limited");
    const prompt = String(formData.get("prompt"));
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
  }
  return <form action={generate} />;
}
