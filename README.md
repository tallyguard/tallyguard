# Tallyguard

A deterministic static analyzer that catches dangerous mistakes AI coding tools routinely
leave in web apps, before they ship. It runs locally, uses no LLM, and your source code never
leaves your machine.

Tallyguard finds a problem that traditional code scanners are structurally bad at, because it
is about a **missing** safeguard rather than a malicious pattern:

- **Unprotected sensitive/expensive endpoints** (no rate limit), the cause of "denial of
  wallet" (a single abused AI endpoint can run up a huge OpenAI/Anthropic bill), brute-force
  logins, and outbound spam.
- **Payment charges with no idempotency key** (Stripe), which double-charge on a retry or a
  redelivered webhook. _(Check-then-act races, Rule 2b, are still planned.)_
- **Secrets exposed to the browser** — a `NEXT_PUBLIC_<secret>` env var (Next inlines it into the
  client bundle), or a paid LLM API called directly from client-side code (the key ships to every
  visitor, and there is no server-side rate limit).

> **Status: published** — run it with `npx tallyguard scan` (no install). What works today: the analyzer and the
> `tallyguard scan` CLI with **four rules across three classes** — the rate-limit class (Detector 1)
> across **Next.js App Router routes, Next.js server actions, NextAuth credential logins, and
> Express** (ESM + CommonJS); **Stripe missing-idempotency-key** (Detector 2a); and **secrets
> exposed to the browser** (Detector 3) — a `NEXT_PUBLIC_<secret>` env var, and a paid LLM API
> called from client-side code. Output is terminal, JSON, and
> SARIF 2.1.0. Validated on a labelled benchmark (100% detection, 0 false positives) and **18
> pinned real AI-built repositories (every finding a hand-verified true positive, 0 false
> positives)**. See the [detection & limits guide](docs/guide/detection-and-limits.md) for
> exactly what is and is not detected, and [benchmark/RESULTS.md](benchmark/RESULTS.md) for the
> published numbers.

## Why it exists

A large share of new apps are built with AI coding tools, which produce working code that omits
safeguards a senior engineer adds automatically. Tallyguard targets that with classic,
deterministic static analysis (no LLM in the detection path), so results are reproducible and
low-noise. The design philosophy is **precision over recall**: a noisy checker gets
uninstalled, so it only flags an endpoint that genuinely reaches a sensitive sink with no rate
limiter reachable on its path. ([Why this bug class matters](docs/guide/why-rate-limiting-matters.md).)

## What it detects today

**`rate-limit/unprotected-sensitive-endpoint`**: a server endpoint that reaches a sensitive sink
with no recognized rate limiter reachable on it.

**`money/missing-idempotency-key`**: a Stripe charge/checkout call
(`paymentIntents`/`charges`/`refunds`/`transfers`/`checkout.sessions` `.create`) with no
idempotency key in its options, which double-charges on a retry or a redelivered webhook. Pass
one in the second argument (`{ idempotencyKey }`).

**`secrets/client-exposed-secret`**: a `NEXT_PUBLIC_`-prefixed env var whose name is unambiguously a
secret (e.g. `NEXT_PUBLIC_STRIPE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`). Next.js
inlines every `NEXT_PUBLIC_` value into the client bundle, so the secret ships to every visitor.
Legitimately-public values (publishable / anon / site keys) are not flagged.

**`secrets/client-side-api-call`**: a paid LLM API host called from client-side code (a `public/`
asset or a `"use client"` file) — the key must be in the browser and there is no server-side rate
limit. Calling your own backend (a proxy) is not flagged.

The rate-limit detector in detail:

- **Surfaces:** Next.js App Router routes, Next.js server actions (`"use server"`), NextAuth /
  Auth.js Credentials logins, and Express (in-file routes, cross-file controllers and routers,
  and mounts).
- **Sinks:** LLM calls (OpenAI, Anthropic, Google, Mistral, Groq, Cohere, Hugging Face,
  Bedrock; the Vercel AI SDK; LangChain; or a raw `fetch` to a known LLM host), auth
  (bcrypt/argon2), outbound email, and SMS.
- **Limiters understood** (so they are not flagged): the common packages, route/handler/
  `app.use` limiters (including a path-scoped `app.use('/api', rateLimit())` covering mounted
  routers), local limiter wrappers, custom rate-limit-named functions, and `middleware.ts`
  matchers.

Reachability follows calls across files (including `@/` aliases and CommonJS). Full detail and
the honest recall limits: **[what Tallyguard detects and its limits](docs/guide/detection-and-limits.md)**.

## Quick start

```bash
npx tallyguard scan ./path/to/your-app
```

No install, runs locally. For CI, add it as a dev dependency (`npm i -D tallyguard`) and run
`tallyguard scan`. To hack on Tallyguard itself, build from source instead:
`npm install && npm run build && node dist/cli/index.js scan <path>`.

### Example

```text
error app/api/chat/route.ts:7  rate-limit/unprotected-sensitive-endpoint
  POST /api/chat reaches a sensitive sink (ai) with no rate limiter reachable on this route.

1 finding(s): 1 error, 0 warning, 0 suppressed
```

### Output and CI

- `--json` for a structured report, `--sarif` for SARIF 2.1.0 (uploadable to GitHub code
  scanning). Exit codes: `0` clean, `2` findings, `1` tool error.
- [CLI reference](docs/guide/cli-reference.md) and [CI integration guide](docs/guide/ci-integration.md).

## Configuration & suppression

Optional `tallyguard.config.json` sets rule levels, edge-handling, the unknown-guard policy,
and suppression rules; inline `tallyguard-disable*` comments (with a required reason by default)
suppress a specific finding, and suppressed findings are always still reported. See the
[suppression & config guide](docs/guide/suppression-and-config.md).

## Limitations (honest, in brief)

- **Frameworks:** Next.js App Router and Express only. Hono, NestJS, tRPC, SvelteKit, Remix, and
  the Next.js `pages/api` router are not modeled (they produce no findings, a recall gap, not a
  false positive).
- Reachability is depth-bounded (default 2); deeper chains or dynamic dispatch can be missed
  (`--max-depth` to go deeper).
- A custom guard with an unrecognized name can be flagged; suppress it with a reason.
- Detector 2 (money) is not implemented yet.

Full list: [detection and limits](docs/guide/detection-and-limits.md).

## Documentation

- **Guide:** [detection & limits](docs/guide/detection-and-limits.md),
  [CLI reference](docs/guide/cli-reference.md),
  [CI integration](docs/guide/ci-integration.md),
  [suppression & config](docs/guide/suppression-and-config.md),
  [why rate limiting matters](docs/guide/why-rate-limiting-matters.md).
- [Benchmark results / teardown](benchmark/RESULTS.md), [rule IDs & suppression spec](docs/specs/SUPPRESSION-AND-FALSE-POSITIVES.md).
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE).
