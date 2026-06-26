import bcrypt from "bcryptjs";
import { findUserByEmail } from "@/lib/users";

// VULNERABLE: a login that compares a password with no rate limit, so it is open to
// brute force and credential stuffing (auth path raises severity).
export async function POST(req: Request) {
  const { email, password } = await req.json();
  const user = await findUserByEmail(email);
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  return Response.json({ ok });
}
