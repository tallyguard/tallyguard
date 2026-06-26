# Contributing to Tallyguard

Thanks for helping. This is a security tool whose entire value is **trustworthy, low-noise
findings**, so the bar is precision and tests, not feature count.

## Setup

Requires Node >= 22 (develop on 22 or 24).

```bash
npm install
npm run typecheck   # strict TypeScript
npm run lint        # ESLint
npm run format      # Prettier
npm test            # Vitest (the benchmark golden tests + unit tests)
npm run build       # tsup -> dist/ (CLI bin + library)
```

All of these gate CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Run them before
opening a PR.

## How the project is organized

`src/core/` is the analyzer (parser/model in `model.ts`, the rate-limit rule in `detector.ts`,
the idempotency rule in `detector-money.ts`, catalogue data in `catalogues.ts`), `src/report/`
the reporters (terminal/JSON/SARIF), `src/cli/` the CLI, `src/app/` the GitHub App, `schema/`
the config JSON Schema, and `benchmark/` the labeled ground truth that doubles as the test
fixtures.

## Common contributions

### Add a sink or rate-limiter to the catalogue

The catalogues are data, not code: edit [src/core/catalogues.ts](src/core/catalogues.ts) (for
example, add an LLM/email/SMS package to `SINK_PACKAGES`, or a limiter package to
`LIMITER_PACKAGES`). **Always add a matched benchmark case** (a vulnerable variant and a safe
variant) so the change is proven, then `npm test`.

### Add a benchmark case

Add a directory under `benchmark/cases/<detector>/<case-id>/` with `vulnerable/`, `safe/`,
and/or `clean/` mini-apps, and register it in
[benchmark/manifest.json](benchmark/manifest.json) with the expected findings. See
[benchmark/README.md](benchmark/README.md). The test suite runs the analyzer over every variant
and asserts the findings equal the manifest.

## Non-negotiables

- **No guessing.** Verify claims against the code or a real run.
- **Tests validate real, correct behavior.** Never weaken, skip, or rewrite a test to make
  broken code pass. If a test fails, fix the cause.
- **Precision over recall.** Prefer missing an edge case over a false positive; only flag what
  reaches a catalogued sink.
- **Keep docs and tests current.** If you change behavior, commands, or the output contracts,
  update the affected docs (`README.md`, `docs/guide/`) and the benchmark in the same PR.

## Commit and PR conventions

Short, imperative commit subjects. Keep PRs focused. CI must be green.
