# Why a missing rate limit is dangerous

Most security scanners look for a **bad pattern**: a SQL string built by concatenation, a
hardcoded secret, an unsafe deserialization. A missing rate limit is the opposite problem, the
**absence of a control**. There is no malicious line to match; the code looks fine. That is
exactly why pattern-based scanners miss it, and why it survives review in fast-moving (often
AI-assisted) codebases where "it works" is the bar.

## What goes wrong without one

- **Denial of wallet.** An endpoint that calls an LLM (OpenAI, Anthropic, a Groq/Mistral API,
  ...) costs money per request. With no limit, anyone with the URL can loop it. A single
  exposed AI endpoint or leaked key has run up five-figure bills in days. This is now the most
  common shape: a chat or "generate" route wired straight to a model with nothing in front of
  it.
- **Brute force on logins (CWE-307).** A credential endpoint with no throttle lets an attacker
  try passwords and one-time codes as fast as the network allows, turning a weak password into
  a breached account.
- **Outbound spam and abuse.** Signup, "resend verification", password-reset, and contact
  endpoints send email or SMS. Unlimited, they become a free spam cannon (and your sender
  reputation and SMS bill pay for it).

The relevant weaknesses are CWE-770 (allocation without limits), CWE-799 (improper control of
interaction frequency), CWE-400 (uncontrolled resource consumption), and CWE-307 (improper
restriction of excessive authentication attempts).

## The subtle failure: a limiter that is not wired up

The dangerous case is not "the project has no rate-limiting library." It is a project that
**installed and configured one but never attached it to the route**. The dependency is in
`package.json`, a limiter is constructed in some file, and a reviewer (or a grep) sees it and
assumes the app is protected, while the sensitive route quietly has nothing on its path.

This is the gap Tallyguard is built around. It does not check whether a limiter exists
somewhere; it checks whether one is actually **reachable on the specific endpoint**, following
calls across files and resolving how routers are mounted. "A limiter exists in the repo" is not
a pass.

## Why deterministic, not AI

These are structural, decidable questions: is a known limiter reachable on this route? Is this
handler reaching a catalogued sink? Classic static analysis answers them precisely, runs
locally for free, gives the same answer every time, and keeps your source code off anyone
else's servers. An LLM-based scanner would add cost, non-determinism, and noise to a question
that does not need it.

The trade is bounded recall: Tallyguard catches the catalogued shapes, not novel ones. It
optimizes for **precision** so that a clean result is trustworthy and a finding is worth acting
on. See [what it detects and its limits](detection-and-limits.md).

## What a fix looks like

Put a reachable limiter on the route, for example with `@upstash/ratelimit` in a Next.js
handler:

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
});

export async function POST(req: Request) {
  const { success } = await ratelimit.limit("chat");
  if (!success) return new Response("Too Many Requests", { status: 429 });
  // ... the LLM call
}
```

or `express-rate-limit` on the route/router in Express, or a path-scoped `app.use('/api',
rateLimit())`. Tallyguard recognizes all of these (and custom limiter functions) and goes quiet
once one is reachable on the endpoint.
