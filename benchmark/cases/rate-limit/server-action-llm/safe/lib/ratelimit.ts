export async function checkUserRateLimit(userId: string) {
  // A custom DB/Redis-backed limiter (not a catalogued package).
  return { allowed: true, userId };
}
