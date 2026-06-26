export async function checkLoginRateLimit(email: string) {
  return { allowed: true, email };
}
