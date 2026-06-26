import bcrypt from "bcryptjs";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { findUserByEmail } from "@/lib/users";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),
});

// SAFE: login throttled per IP before the password compare.
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const { success } = await ratelimit.limit(ip);
  if (!success) return new Response("Too Many Requests", { status: 429 });

  const { email, password } = await req.json();
  const user = await findUserByEmail(email);
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  return Response.json({ ok });
}
