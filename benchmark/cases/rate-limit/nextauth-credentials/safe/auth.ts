import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "./users";
import { checkLoginRateLimit } from "./ratelimit";

// SAFE: the authorize callback enforces a custom per-identifier login rate limit first.
export const { handlers, auth } = NextAuth({
  providers: [
    Credentials({
      authorize: async (credentials) => {
        const email = String(credentials?.email);
        const rl = await checkLoginRateLimit(email);
        if (!rl.allowed) return null;

        const user = await getUserByEmail(email);
        if (!user) return null;
        const ok = await bcrypt.compare(String(credentials?.password), user.passwordHash);
        return ok ? { id: user.id, email: user.email } : null;
      },
    }),
  ],
});
