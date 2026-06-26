import { ask } from "../../../lib/ai";

// VULNERABLE: the sink is in a helper (lib/ai.ts), not inline. No rate limit.
// Requires cross-file reachability to detect.
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const text = await ask(String(prompt));
  return Response.json({ text });
}
