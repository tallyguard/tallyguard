"use server";

import OpenAI from "openai";
import { checkUserRateLimit } from "../lib/ratelimit";

const openai = new OpenAI();

export async function generatePlan(userId: string, goal: string) {
  const rl = await checkUserRateLimit(userId);
  if (!rl.allowed) throw new Error("rate limited");

  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: goal }],
  });
  return c.choices[0]?.message?.content ?? "";
}
