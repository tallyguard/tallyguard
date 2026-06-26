// VULNERABLE: calls an LLM API by raw fetch (no SDK), no rate limiter.
export async function POST(req: Request) {
  const { messages } = await req.json();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages }),
  });
  return Response.json(await r.json());
}
