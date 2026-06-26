import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

// A HOF that rate-limits, then delegates to the wrapped handler.
export function withRateLimit(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const { success } = await limiter.limit("key");
    if (!success) return new Response("Too Many Requests", { status: 429 });
    return handler(req);
  };
}
