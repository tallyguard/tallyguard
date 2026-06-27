# Spec: False-positive policy, rule IDs, and suppression

**Status:** Implemented. The rule IDs, the inline-comment grammar, and the config file shape
are committed API surface (contracts users and CI depend on), so they are not changed lightly.
Inline suppressions live in `src/suppress.ts` and are applied via `scanProject`
(`src/scan.ts`); config-level controls live in `src/config.ts`.

This spec defines the false-positive policy and the suppression mechanics: the rule IDs, the
inline-comment grammar, the config schema, the unknown-guard policy, and how suppressed
findings are surfaced rather than dropped.

---

## 1. Governing stance: precision over recall

A noisy checker gets uninstalled, so trust is the whole asset. Two consequences drive every
rule below:

- **Prefer precision, but flag-and-inform where the harm is high and easily checked.** Only
  flag what reaches a catalogued sink. For the narrow ambiguous case of a sensitive endpoint
  guarded by a limiter we do not recognize, the default is to **flag with an informative
  message** (naming the unrecognized guard) so the developer can confirm or suppress, rather
  than silently assume it is safe (see the unknown-guard policy, Section 5).
- **Suppression is first-class and honest.** Users can suppress findings, but suppressions
  are recorded and surfaced, never silently dropped (Section 6). The tool's own
  false-positive rate is published on the benchmark.

---

## 2. Rule ID scheme

Format: `<category>/<slug>`, lowercase, hyphenated, stable forever once shipped. The ID is
the SARIF `ruleId` and the token used in suppression comments and config.

| Rule ID                                     | Detector   | Default severity | CWE                                                                                                                       |
| ------------------------------------------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `rate-limit/unprotected-sensitive-endpoint` | Detector 1 | error            | CWE-799 (primary); CWE-770 / CWE-400 when the harm is resource/wallet exhaustion; CWE-307 when the path is authentication |
| `money/missing-idempotency-key`             | Rule 2a    | error            | [to confirm] no CWE sourced yet; do not invent one (see DECISIONS D019)                                                   |
| `money/check-then-act-race`                 | Rule 2b    | warn             | CWE-367 (parent CWE-362)                                                                                                  |
| `secrets/client-exposed-secret`             | Detector 3 | error            | CWE-200                                                                                                                   |
| `secrets/client-side-api-call`              | Detector 3 | error            | CWE-200; CWE-522                                                                                                          |

Notes:

- Severities are defaults; the config can raise, lower, or turn a rule off (Section 4).
- Context can raise severity at finding time (for example, `money/missing-idempotency-key`
  inside a detected webhook handler is raised above the default), independent of config.
- `money/check-then-act-race` defaults to `warn` because it carries the highest
  false-positive risk and ships only after Rule 2a is credible (plan Section 4.2, 10).
- The CWE for `money/missing-idempotency-key` is deliberately left unset until a primary
  source is confirmed. The detector still ships; the SARIF `ruleId` and message stand on
  their own.

---

## 3. Inline suppression comments

Convention follows the widely understood ESLint-style disable comments, with a `tallyguard-`
prefix so it never collides with other tools.

```ts
// tallyguard-disable-next-line rate-limit/unprotected-sensitive-endpoint -- handled by API gateway
export async function POST(req: Request) { /* ... */ }

const charge = stripe.paymentIntents.create(params); // tallyguard-disable-line money/missing-idempotency-key -- replayed by our outbox

// tallyguard-disable money/check-then-act-race -- guarded by an external lock, see RFC-12
... block of code ...
// tallyguard-enable money/check-then-act-race

/* tallyguard-disable-file rate-limit/unprotected-sensitive-endpoint -- internal admin tool, not internet-facing */
```

Grammar:

- `tallyguard-disable-next-line [<ruleId>[,<ruleId>...]] [-- <reason>]` suppresses on the
  next source line.
- `tallyguard-disable-line [<ruleId>...] [-- <reason>]` suppresses on the same line.
- `tallyguard-disable [<ruleId>...] [-- <reason>]` ... `tallyguard-enable [<ruleId>...]`
  suppresses a block. An unclosed `disable` extends to end of file.
- `tallyguard-disable-file [<ruleId>...] [-- <reason>]` suppresses the whole file. Must
  appear before the first finding location.
- Rule IDs are comma-separated. **Omitting the rule ID suppresses all rules** at that scope;
  this is discouraged and can be forbidden by config (`suppressions.allowBlanket: false`).
- Everything after `--` is the human reason. **A reason is required by default**
  (`suppressions.requireReason: true`): a suppression without a reason is itself reported as
  a finding (`tallyguard/suppression-without-reason`). Set `requireReason: false` to relax
  this.

---

## 4. Repo-level configuration

File: `tallyguard.config.json` at the project root (nearest one above the scan root wins; a
`--config <path>` flag overrides discovery). JSON with a `$schema` pointer for editor
completion. The machine-readable contract is
[schema/tallyguard.config.schema.json](../../schema/tallyguard.config.schema.json).

```jsonc
{
  "$schema": "https://tallyguard.dev/schema/tallyguard.config.schema.json",
  "version": 1,
  "include": ["**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**", "**/*.test.*"],
  "rules": {
    "rate-limit/unprotected-sensitive-endpoint": "error",
    "money/missing-idempotency-key": "error",
    "money/check-then-act-race": "warn",
  },
  "rateLimit": {
    "handledAtEdge": false,
    "edgeHandledPaths": [],
    "unknownGuard": "flag",
  },
  "suppressions": {
    "requireReason": true,
    "allowBlanket": true,
  },
}
```

- `rules`: per-rule level, one of `error | warn | off`. Maps to exit codes (Section 7) and
  SARIF `level`.
- `rateLimit.handledAtEdge`: when `true`, Detector 1 is globally suppressed (the team
  declares a gateway/WAF/platform limiter handles it; the plan Section 4.1 calls for this
  honest escape hatch). `edgeHandledPaths` scopes that declaration to route globs instead of
  globally.
- `rateLimit.unknownGuard`: the boundary policy of Section 5.
- `suppressions.requireReason` / `allowBlanket`: govern the inline comments of Section 3.

---

## 5. Unknown-guard boundary policy

When a route reaches a sensitive sink (Detector 1), the analyzer checks whether a recognized
rate-limit guard (plan Appendix B) is reachable on its path. This policy governs only the
narrow ambiguous case: a route that **has** a guard the catalogue does not recognize. (A
route with no guard at all is always flagged at full confidence; a route with a recognized
limiter is never flagged. Neither is affected by this setting.)

Behavior is governed by `rateLimit.unknownGuard`:

- `flag` (default): flag the route, but with an informative message that names the
  unrecognized guard and tells the developer how to resolve it: confirm it is actually a
  rate limiter and, if so, either add it to the catalogue (a contribution) or suppress the
  finding with a reason. This favors catching real gaps while keeping the cost of a false
  positive low (a clear message plus a one-line, reasoned suppression). It is what a
  developer asked for: surface it so they can check.
- `suppress`: assume the unknown guard may be protective and do not flag (recorded in the
  suppressed/auditable output per Section 6, never hidden). Higher precision, lower recall;
  opt-in.

The unrecognized-guard finding is lower-confidence than a no-guard finding; emitting it at a
reduced severity is a possible refinement to settle when the detector is built (roadmap 1.4),
not in this config version.

The call-graph depth for sink reachability is bounded (plan Section 7.1 says one to two
levels); the default is 2 and is a separate `graph.maxDepth` concern handled when the core
model lands (roadmap 1.3), not in this config version.

---

## 6. How suppressions surface (honesty requirement)

Suppressed findings are recorded, not discarded:

- **JSON output:** a finding carries a `suppressed` object `{ "by": "inline" | "config",
"rule": "<ruleId>", "reason": "<text|null>" }`. Suppressed findings appear in a separate
  `suppressed` array, not in the active `findings` array.
- **SARIF 2.1.0:** emit the result with a `suppressions` array
  (`[{ "kind": "inSource" | "external" }]`), which is the standard way GitHub code scanning
  represents a suppressed-but-known result. The result is still present in the run.
- **Terminal:** active findings are shown; suppressed ones are summarized as a count
  (`N suppressed`) and listed only with `--show-suppressed`.

This keeps the published false-positive and suppression numbers honest and auditable.

---

## 7. Exit codes (cross-reference)

The CLI exit-code contract (D016) interacts with rule levels:

- `0` ran clean: no active `error`-level findings.
- `2` findings: at least one active `error`-level finding (suppressed findings do not trip
  this; `warn`-level findings do not trip this by default).
- `1` tool error.

A future `--max-warnings` style control can tighten this; not in scope for v1.

---

## 8. Test plan (for when this is implemented)

- Golden fixtures per suppression form (next-line, line, block, file, blanket,
  with/without reason) asserting the finding is moved to `suppressed` with the right
  `by`/`reason`.
- Config-validation tests: example configs validate against
  `schema/tallyguard.config.schema.json`; invalid configs are rejected with a clear error.
- `requireReason: true` produces `tallyguard/suppression-without-reason` for a reasonless
  suppression.
- SARIF contract test: a suppressed finding emits a `suppressions` entry and still appears
  in `results`.
- Exit-code tests: clean = 0, active error finding = 2, all findings suppressed = 0,
  tool error = 1.
