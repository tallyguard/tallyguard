import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

export async function enforceLimit(ip: string): Promise<void> {
  const { success } = await ratelimit.limit(ip);
  if (!success) throw new Error("Too Many Requests");
}
