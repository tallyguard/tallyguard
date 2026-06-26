import OpenAI from "openai";
import { withThrottle } from "@/lib/throttle";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// FLAG-WITH-INFO: the route is wrapped in a custom guard `withThrottle` that the
// catalogue does not recognize. Per the unknown-guard policy (D024, default "flag"),
// this is flagged with a message naming the guard so the developer can verify it,
// add it to the catalogue, or suppress with a reason.
export const POST = withThrottle(async (req: Request) => {
  const { prompt } = await req.json();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: String(prompt) }],
  });
  return Response.json({ text: completion.choices[0]?.message?.content ?? "" });
});
