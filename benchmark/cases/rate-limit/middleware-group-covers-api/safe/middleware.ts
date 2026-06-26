import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

export async function middleware(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const { success } = await ratelimit.limit(ip);
  if (!success) return new NextResponse("Too Many Requests", { status: 429 });
  return NextResponse.next();
}

// SAFE: a group matcher that includes /api, so the LLM route is covered. Must NOT be flagged.
// (Prefix-only matching used to miss this and raise a false positive.)
export const config = { matcher: ["/(api|trpc)(.*)"] };
