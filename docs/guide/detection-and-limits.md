# What Tallyguard detects, and its limits

This is the page to read before you trust a clean result. Tallyguard is built on a single
promise: **precision over recall**. A scanner that cries wolf gets uninstalled, so Tallyguard
would rather miss a real issue than flag a safe one. That trade has a cost, and this page
states it plainly: what is detected, the measured false-positive rate, and the cases that are
deliberately not flagged.

Detection is classic, deterministic static analysis (no LLM in the detection path). Your
source code never leaves your machine.

---

## The detector

`rate-limit/unprotected-sensitive-endpoint` (CWE-770 / 799 / 400, and CWE-307 for logins): a
server endpoint that reaches a sensitive or expensive operation with no rate limiter reachable
on its path. The harm is denial-of-wallet (one abused AI endpoint can run a five-figure bill),
brute force on logins, and outbound spam.

A finding is only raised when **both** are true: the endpoint reaches a catalogued sink, and
no recognized limiter covers it. "A limiter exists somewhere in the repo" is not enough; it
must actually be wired to that endpoint.

`money/missing-idempotency-key` (Detector 2a): a Stripe create-call that moves or commits money
(`paymentIntents`, `charges`, `refunds`, `transfers`, `checkout.sessions` `.create`) with no
idempotency key in its second (RequestOptions) argument. Without it, a retried request or a
redelivered webhook can create a duplicate charge. This is a per-call check (the create-call is
itself the defect); it runs only when the project depends on the `stripe` package, and an
unresolvable options argument is treated as present (so only a confidently-absent key is
flagged). A non-Stripe `.create` (e.g. a Prisma model) is never matched.

The check-then-act race detector (Rule 2b) is **not built yet**.

---

## Surfaces analyzed

- **Next.js App Router** route handlers (`app/**/route.ts`, the exported `GET`/`POST`/...).
- **Next.js server actions** (files with a top-level `"use server"`; each exported async
  function is a client-callable endpoint).
- **NextAuth / Auth.js Credentials sign-in** (the `authorize` callback, i.e. the login
  endpoint).
- **Express** (ESM and CommonJS): in-file routes, handlers and limiters resolved across files
  (controllers via `exports.x` / `module.exports`, imported routers), and cross-file router
  mounts tied to their mount path.

## Sinks recognized (a versioned catalogue)

- **AI / LLM** (cost / denial-of-wallet): OpenAI, Anthropic, Google, Mistral, Groq, Cohere,
  Hugging Face, AWS Bedrock, Replicate; the Vercel AI SDK cost calls (`generateText`,
  `streamText`, `generateObject`, embeddings, ...); LangChain; and a **raw `fetch` to a known
  LLM host** (no SDK).
- **Auth**: bcrypt, bcryptjs, argon2.
- **Outbound email**: nodemailer, SendGrid, Resend, Postmark, Mailgun, AWS SES.
- **SMS**: Twilio, Vonage, Plivo, MessageBird.

## Limiters recognized (so they are not flagged)

- Packages: `@upstash/ratelimit`, `rate-limiter-flexible`, `express-rate-limit`,
  `express-slow-down`, `@fastify/rate-limit`, `@nestjs/throttler`, `limiter`.
- A limiter applied at the route, in the handler, via `app.use([path,] limiter)` (including a
  path-scoped `app.use('/api', rateLimit())` that covers routers mounted under it), or imported
  from a local wrapper module.
- A **custom function whose name looks like a limiter** (`rateLimit`, `throttle`, `slowDown`,
  `checkEmailRateLimit`, ...), so project-specific limiters do not false-positive.
- A **HOF wrapper that enforces a limiter** (`export const POST = withWorkspace(handler)` where
  `withWorkspace` rate-limits in its own body); the wrapper is resolved and analyzed, not just
  the inner handler.
- A Next.js `middleware.ts` limiter whose `matcher` covers the route.

---

## Measured false-positive rate (our own numbers, reproducible)

Credibility comes from publishing this honestly, not from hiding it.

- **Benchmark** (`npm run benchmark`, hand-labelled vulnerable/safe pairs): **100% detection,
  0 false positives over 28 safe/clean variants.**
- **Real repositories** (`npm run realworld`, 18 pinned open-source AI-built repos): every
  expected finding is a hand-verified true positive, **0 false positives**, asserted exactly
  on each pinned commit.

These suites are the merge gate: a regression in the false-positive rate fails CI. The corpus
spans Next.js routes, server actions, NextAuth logins, and Express (single-file, split
controllers, and a 30+-route app that path-scopes its limiter).

Three real false-positive classes were found and fixed while building this corpus: treating
Vercel AI SDK utilities (not just its cost calls) as sinks; and missing a path-scoped
`app.use('/api', limiter)` so routers mounted under it were wrongly flagged. The benchmark now
guards against both.

---

## What is deliberately NOT flagged (recall limits)

Static analysis has bounded recall. These are the known gaps; none of them is a false positive,
each is a possible missed detection.

- **Unmodeled frameworks.** Hono, NestJS (decorator routes), tRPC, SvelteKit, Remix, and the
  Next.js `pages/api` router are not analyzed and produce no findings. Verified that they stay
  silent rather than misfire.
- **Depth-bounded reachability.** A sink reached only through a chain deeper than the default
  (2 call hops) or through dynamic dispatch can be missed. Raise it with `--max-depth`.
- **Custom guards with an unrecognized name.** A limiter recognized neither by package nor by a
  rate-limit-like name (seen in the wild: a daily-quota reservation `reserveBioRegenSlot()`) is
  not detected, so a guarded route may be flagged. This is the unknown-guard case; resolve it
  with an inline suppression and a reason.
- **NextAuth `authorize` that verifies the password via an external API** (no local
  bcrypt/argon2) reaches no catalogued sink, so it is not flagged.
- **Inline `"use server"` closures** (server actions defined inside another function) are not
  modeled; top-level `"use server"` files are.
- **Edge / gateway / WAF limits and runtime config** are outside the code and cannot be seen.
  If rate limiting is handled there, set `rateLimit.handledAtEdge: true` in your config or
  suppress with a reason.
- **Split-router reported paths** are router-local (`/login`, not `/api/auth/login`); the file
  and line still pinpoint the route.
- **Monorepos: scan the app directory, not the repo root.** Cross-file resolution (handlers,
  wrappers, sinks, `@/` aliases) relies on the project's `tsconfig` paths, which in a monorepo
  live in the app directory (e.g. `apps/web`). Scanning the repo root can leave aliases
  unresolved and cause both misses and the occasional false positive; scan `apps/web` instead.

If you hit a false positive that is not one of the above, it is a bug worth reporting: precision
is the whole point.

---

## Tuning and honesty controls

- `tallyguard.config.json` sets rule levels, `rateLimit.handledAtEdge`, the `unknownGuard`
  policy (`flag` by default, surfaced for review), and whether suppressions require a reason.
- Suppressed findings are always reported (JSON `suppressed`, SARIF `result.suppressions`,
  terminal `--show-suppressed`), never silently dropped, so the published numbers stay honest.

See the [CLI reference](cli-reference.md), the [suppression & config guide](suppression-and-config.md),
and [why this bug class matters](why-rate-limiting-matters.md).
