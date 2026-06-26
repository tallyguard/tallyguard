# Tallyguard benchmark

Labeled ground truth for the analyzer: small, matched code samples that are either vulnerable
or safe, with the findings the analyzer is expected to report. This is both the public proof
(detection rate and the tool's own false-positive rate are published from it) and the source
of the test fixtures (the benchmark and the test corpus share fixtures by design).

For the published results, the incumbent comparison, and how to reproduce them, see
**[RESULTS.md](RESULTS.md)**.

It covers both detectors: **`rate-limit/unprotected-sensitive-endpoint`** (Next.js App Router
routes, server actions, NextAuth credential logins, and Express) and
**`money/missing-idempotency-key`** (Stripe). It grows with each sink, framework, and detector.

## Layout

```
benchmark/
  manifest.json   the labels: each case, its variants, and the expected findings
  RESULTS.md      the public teardown (detection + false-positive rate, incumbent comparison)
  cases/
    rate-limit/<case-id>/{vulnerable,safe,clean}/   mini-apps the analyzer should/should not flag
    money/<case-id>/{vulnerable,safe}/              Stripe idempotency cases
```

Each variant root (for example `cases/rate-limit/llm-openai-unprotected/vulnerable`) is a
self-contained mini Next.js app rooted at that directory, so `app/api/.../route.ts` paths are
relative to it. The fixtures import packages (`openai`, `@upstash/ratelimit`, `next/server`)
that are not installed; they are never compiled or executed, only statically analyzed, so that
is intentional. They are excluded from typecheck (tsconfig) and lint (eslint ignores) precisely
because some are deliberately flawed.

## The cases

`manifest.json` is the source of truth for the full case list (each grows over time, so it is
not duplicated here). The corpus deliberately includes the hardest, most valuable shapes:

- the **limiter present but not wired** case (the common AI-built failure, which needs
  cross-file reachability, not grep);
- **false-positive controls** that must stay clean (a non-sensitive route; a correctly
  rate-limited route; a Prisma `.create` beside a Stripe one; a HOF wrapper that rate-limits);
- the cross-file, multi-framework patterns found by scanning real apps (path-scoped
  `app.use` limiters covering mounted routers, custom rate-limit-named guards, server actions,
  NextAuth credential logins, raw-`fetch` LLM calls, and Stripe idempotency).

## How it is consumed

- **Manifest:** `manifest.json` is the single source of truth for labels. A variant's `expect`
  array lists `{ rule, file }` findings; an empty array means the analyzer must report nothing.
  Matching is on `(rule, file)`; line numbers are omitted to stay robust to edits.
- **Tests:** the Vitest suite runs the analyzer over each variant root and asserts the findings
  equal `expect` (golden-file style). No test is weakened to pass.
- **Benchmark scorer:** `node tools/benchmark/score.mjs` (`npm run benchmark`) drives the
  published detection-rate and false-positive-rate numbers and gates CI on no FP-rate
  regression. The real-repo regression suite is `npm run realworld`.

## Limitations

This is a hand-written plus real-repo corpus, so it proves correctness on known shapes, not
recall on novel ones. It expands with more frameworks/sinks and with cases harvested from real
AI-built apps (project plan Section 9) as the analyzer matures. The tool's own recall limits are
published in [the detection-and-limits guide](../docs/guide/detection-and-limits.md).
