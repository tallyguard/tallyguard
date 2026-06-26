# CLI reference

Tallyguard follows the [Command Line Interface Guidelines](https://clig.dev): machine-readable
output, `NO_COLOR` support, plain output when piped, and stable, documented exit codes.

Until it is published to npm, run it from a build:

```bash
npm install && npm run build
node dist/cli/index.js scan <path>
```

Once published this is `npx tallyguard scan <path>`.

---

## `scan <path>`

Scans the project rooted at `<path>` and reports findings. Only the project's own source is
read; `node_modules` and build output (`dist`, `.next`, `build`, `out`, `coverage`) are
excluded, and files over ~1.5 MB are skipped. Tallyguard never executes the target code.

### Options

| Flag                | Effect                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `--json`            | Emit the structured JSON report (a versioned integration contract).             |
| `--sarif`           | Emit SARIF 2.1.0 (uploadable to GitHub code scanning).                          |
| `--format <fmt>`    | `terminal` (default), `json`, or `sarif`.                                       |
| `--config <file>`   | Use a specific `tallyguard.config.json` (default: nearest above the scan root). |
| `--max-depth <n>`   | Call-graph reachability depth (default 2). Higher = more recall, slower.        |
| `--show-suppressed` | Also list suppressed findings in the terminal output.                           |

`NO_COLOR` (or a non-TTY / piped stdout) disables ANSI color; severity is never conveyed by
color alone.

### Exit codes (stable contract, safe to gate CI on)

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| `0`  | Ran clean, no findings.                                             |
| `2`  | Findings reported.                                                  |
| `1`  | Tool error (it never reports a false "clean" on an internal error). |

### Example

```text
error app/api/chat/route.ts:7  rate-limit/unprotected-sensitive-endpoint
  POST /api/chat reaches a sensitive sink (ai) with no rate limiter reachable on this route.

1 finding(s): 1 error, 0 warning, 0 suppressed
```

---

## Output contracts

JSON and SARIF are versioned integration contracts; rule IDs and CWE tags are stable.

- **JSON** (`--json`): a top-level summary plus a `findings` array and a `suppressed` array.
  Each finding carries the rule ID, file, line, severity, message, and sink category.
- **SARIF 2.1.0** (`--sarif`): the only version GitHub code scanning accepts. CWE tags are
  emitted as rule `tags`, and suppressed findings appear with `result.suppressions` (not
  dropped). Validated against the official 2.1.0 schema in CI.

Every finding includes: file + line, the operation detected, why it is risky, the missing
safeguard, a severity, a suggested direction, and a stable rule ID + CWE tag.
