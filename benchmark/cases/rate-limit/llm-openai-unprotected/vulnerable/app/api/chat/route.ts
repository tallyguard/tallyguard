import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// VULNERABLE: an LLM call on a public POST route with no rate limit.
// An abused or leaked endpoint runs up an unbounded OpenAI bill (denial of wallet).
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: completion.choices[0]?.message?.content ?? "" });
}
