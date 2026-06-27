import { getResend } from "../../../lib/email";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

// SAFE: same lazily-built sink client, but a limiter guards the route, so it must stay clean
// even though the lazy client is now recognized.
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const { success } = await ratelimit.limit(ip);
  if (!success) return new Response("Too Many Requests", { status: 429 });
  const { email } = await req.json();
  const client = getResend();
  await client.emails.send({
    from: "noreply@example.com",
    to: String(email),
    subject: "Hello",
    html: "<p>hi</p>",
  });
  return Response.json({ ok: true });
}
