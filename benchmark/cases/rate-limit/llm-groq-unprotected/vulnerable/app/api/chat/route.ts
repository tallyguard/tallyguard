import Groq from "groq-sdk";

const groq = new Groq();

// VULNERABLE: a Groq LLM call on a public POST route with no rate limiter.
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const c = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: c.choices[0]?.message?.content ?? "" });
}
