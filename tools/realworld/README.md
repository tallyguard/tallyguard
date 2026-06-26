# Real-repo validation

A deterministic regression suite that runs the analyzer against **real AI-built
repositories**, not just the hand-written benchmark. Each repo in
[corpus.json](corpus.json) is pinned at a commit SHA with hand-verified expected findings
(every one confirmed a true positive: the route reaches a catalogued sink and the repo has no
rate limiting reachable on it).

The corpus currently spans both frameworks: three Next.js App Router repos, one CommonJS
single-file Express app, and one ESM Express app whose routes are split across a router and a
controller file.

Because the SHA is pinned, the analyzer's output is deterministic, so `run.mjs` asserts an
**exact match** and fails on either:

- a **missing** expected finding (a regression: a true positive we stopped detecting), or
- a **new** finding (to review: a possible false positive, or a genuine new true positive that
  should be added to the corpus after verification).

Matching is by a multiset of `file::rule`, so the **count** of findings per file is asserted
too (a repo expecting three findings in one file fails if only two are reported). Line numbers
are intentionally omitted to stay robust to reformatting.

## Run

```
npm run realworld
```

It builds, then clones each repo at its pinned SHA (shallow), scans it, and reports
PASS/FAIL per repo. It is **network-dependent**, so it is a separate harness rather than part
of the offline unit-test gate (which uses the in-repo benchmark fixtures).

## Adding a repo

1. Find a real repo with a genuine, hand-verified true positive (or a clean repo to guard
   against false positives).
2. Add `{ repo, sha, framework, expect: [{ file, rule }] }` to `corpus.json`, pinning the SHA.
3. Run `npm run realworld` and confirm it passes.
