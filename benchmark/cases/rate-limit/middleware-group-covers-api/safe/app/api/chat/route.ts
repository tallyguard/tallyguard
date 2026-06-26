import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const c = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
}
