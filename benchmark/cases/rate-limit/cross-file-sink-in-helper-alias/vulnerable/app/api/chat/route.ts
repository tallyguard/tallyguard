import { ask } from "@/lib/ai";

// VULNERABLE: sink in a helper imported via the `@/` path alias. No rate limit.
// Requires reading the project's tsconfig paths to resolve the import.
export async function POST(req: Request) {
  const { prompt } = await req.json();
  return Response.json({ text: await ask(String(prompt)) });
}
