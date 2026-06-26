// CLEAN control: proxies to a separate backend via a dynamic env-var URL (not a known LLM
// host), so the LLM cost/limit belongs downstream. Must NOT be flagged.
export async function POST(req: Request) {
  const r = await fetch(`${process.env.BACKEND_URL}/ai/chat`, {
    method: "POST",
    body: JSON.stringify(await req.json()),
  });
  return new Response(r.body);
}
