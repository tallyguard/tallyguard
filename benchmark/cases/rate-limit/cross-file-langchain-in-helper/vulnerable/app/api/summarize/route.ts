import { summarize } from "../../../lib/chain";

// VULNERABLE: LangChain LLM call in a helper, no rate limit (mirrors a real corpus repo).
export async function POST(req: Request) {
  const { text } = await req.json();
  return Response.json({ summary: await summarize(String(text)) });
}
