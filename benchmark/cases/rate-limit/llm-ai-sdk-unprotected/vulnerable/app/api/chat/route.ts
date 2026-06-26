import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// VULNERABLE: a Vercel AI SDK LLM call on a public POST route with no rate limit.
// This is the dominant real-world shape (denial of wallet on the AI bill).
export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = streamText({ model: openai("gpt-4o-mini"), messages });
  return result.toTextStreamResponse();
}
