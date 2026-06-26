"use server";

import OpenAI from "openai";

const openai = new OpenAI();

export async function generatePlan(goal: string) {
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: goal }],
  });
  return c.choices[0]?.message?.content ?? "";
}

// Non-sensitive action (no sink): must NOT be flagged.
export async function saveTheme(theme: string) {
  return theme.trim();
}
