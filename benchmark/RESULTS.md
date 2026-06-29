# Benchmark results: what Tallyguard catches, and what other tools miss

This is the public teardown. It exists to be checked, not believed: every number here is
reproducible from this repository with one command, and Tallyguard's own false-positive rate is
published alongside its detection rate. A benchmark that hides its false positives is marketing;
this one does not.

Detection is classic, deterministic static analysis (no LLM in the detection path), so the same
input always gives the same output.

## Headline numbers

| Measure                               | Tallyguard                                  |
| ------------------------------------- | ------------------------------------------- |
| Detection on the labelled benchmark   | **100%** (33/33 expected findings reported) |
| False-positive rate on the benchmark  | **0%** (0 across 33 safe/clean variants)    |
| Real pinned repositories validated    | **19** (every finding hand-verified)        |
| False positives across those 19 repos | **0**                                       |

Reproduce:

```bash
npm install && npm run build
npm run benchmark    # the labelled corpus: detection + false-positive rate
npm run realworld    # 19 pinned real repos (incl. a FastAPI app), exact-match regression (network)
```

## The gap: what a leading free SAST tool finds here

The two defect classes Tallyguard targets are about a **missing** control, which pattern-based
scanners are structurally bad at. In our incumbent-baseline run:

> **Semgrep Community Edition 1.167.0**, with 94 applicable community rules
> (`p/javascript`, `p/typescript`, `p/security-audit`, `p/owasp-top-ten`) over the rate-limit
> corpus, reported **0 findings** (0 rate-limit / denial-of-wallet related).

That is not a knock on Semgrep; there is simply no malicious pattern to match when the bug is an
absent rate limiter or an absent idempotency key. Tallyguard finds them by modelling the
route/handler graph and checking whether a guard is actually reachable, which is the part a
single-file pattern scan cannot do.

## What the benchmark covers

Three detector classes (four rules), across the surfaces real AI-built apps actually use:

- **`rate-limit/unprotected-sensitive-endpoint`** on Next.js App Router routes, Next.js server
  actions, NextAuth credential logins, and Express (ESM + CommonJS, cross-file controllers,
  routers, and mounts). Sinks: LLM calls (raw SDKs, the Vercel AI SDK, LangChain, or a raw
  `fetch` to a known LLM host), auth, email, SMS. It recognises a limiter at the route, in the
  handler, via `app.use` (including a path-scoped one covering mounted routers), via a HOF
  wrapper, as a custom rate-limit-named helper, or in a `middleware.ts` matcher, so a protected
  route is not flagged.
- **`money/missing-idempotency-key`**: a Stripe charge/checkout create-call
  (`paymentIntents`/`charges`/`refunds`/`transfers`/`checkout.sessions`) with no idempotency key,
  which double-charges on a retry or a redelivered webhook.
- **`secrets/client-exposed-secret`**: a client-exposed secret env var - `NEXT_PUBLIC_<secret>`
  (Next.js) or `VITE_<secret>` (Vite), which the bundler inlines into the browser bundle - plus
  **`secrets/client-side-api-call`**: a paid LLM API called directly from client-side code.
- **`rate-limit` on Python/FastAPI**: a FastAPI route (`@router.post`) whose handler reaches an auth
  or LLM sink **across files** (handler -> service -> helper) with no slowapi / fastapi-limiter
  limiter; the matched safe variant adds one. A pinned real FastAPI SaaS is in the realworld suite.

The labelled corpus pairs each vulnerable case with a matched safe version, and includes
deliberate false-positive controls (a non-sensitive route; a Prisma `.create` next to a Stripe
one; a correctly rate-limited route). The 19 real repositories include personal AI-built apps,
flagship templates (the official Vercel AI chatbot and LangChain Next.js template), and a
rate-limited app kept as a clean control that must stay clean.

## How the defect rates were established (validation-first)

- **Rate limiting:** a frequency scan of 51 real AI-built repositories found a sensitive
  server-side surface in 18, of which **72% had no rate limiter** (the dominant sink was AI/LLM
  calls).
- **Idempotency:** of real Stripe-using repositories scanned, **~78% had a charge/checkout
  create-call with no idempotency key**.

So both defects are common in the wild, not hypothetical.

## Honesty: the false-positive rate and the recall limits

Precision is the whole asset, so the limits are published, not buried:
[what Tallyguard detects and its limits](../docs/guide/detection-and-limits.md). In short, it is
deliberately quiet on frameworks it does not model (Hono, NestJS, tRPC, SvelteKit, Remix, the
Next.js `pages/api` router), on chains deeper than the default reachability depth, and on custom
guards with an unrecognised name. Those are missed detections, never false alarms. If you find a
false positive that is not a documented limit, that is a bug worth reporting.
