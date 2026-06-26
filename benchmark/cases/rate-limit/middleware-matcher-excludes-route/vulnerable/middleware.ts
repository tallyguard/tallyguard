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

// VULNERABLE: the matcher covers /api/admin but NOT /api/chat, so the LLM route
// below is not actually protected by this middleware.
export const config = { matcher: ["/api/admin/:path*"] };
