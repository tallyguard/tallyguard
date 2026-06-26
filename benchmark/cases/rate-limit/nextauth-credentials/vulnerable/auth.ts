import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getUserByEmail } from "./users";

// VULNERABLE: the Credentials authorize verifies a password (bcrypt) with no rate limiting,
// so the login endpoint (/api/auth/callback/credentials) can be brute-forced.
export const { handlers, auth } = NextAuth({
  providers: [
    Credentials({
      authorize: async (credentials) => {
        const user = await getUserByEmail(String(credentials?.email));
        if (!user) return null;
        const ok = await bcrypt.compare(String(credentials?.password), user.passwordHash);
        return ok ? { id: user.id, email: user.email } : null;
      },
    }),
  ],
});
