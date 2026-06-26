# Suppression & configuration

Static analysis cannot see everything (an edge gateway limit, a custom guard with an unusual
name). When Tallyguard flags something you know is safe, suppress it honestly rather than
disabling the tool. Suppressed findings are always still reported (never silently dropped), so
your numbers stay auditable.

For the full grammar and the design rationale, see the spec:
[SUPPRESSION-AND-FALSE-POSITIVES](../specs/SUPPRESSION-AND-FALSE-POSITIVES.md). This page is the
quick reference.

## Inline suppression

ESLint-style comments with a `tallyguard-` prefix. A reason (after `--`) is required by
default.

```ts
// tallyguard-disable-next-line rate-limit/unprotected-sensitive-endpoint -- handled by the API gateway
export async function POST(req: Request) {
  /* ... */
}
```

Forms:

- `tallyguard-disable-next-line [rules] -- reason`
- `tallyguard-disable-line [rules] -- reason`
- `tallyguard-disable [rules] -- reason` ... `tallyguard-enable [rules]` (a block)
- `tallyguard-disable-file [rules] -- reason`

Omitting the rule IDs suppresses all rules at that location. A suppression with no reason is
itself reported as `tallyguard/suppression-without-reason` (configurable).

## `tallyguard.config.json`

Place it at your project root (or pass `--config`). It is validated against
[the schema](../../schema/tallyguard.config.schema.json); a typo or invalid value fails the run.

```jsonc
{
  "$schema": "https://tallyguard.dev/schema/tallyguard.config.schema.json",
  "version": 1,
  "rules": {
    "rate-limit/unprotected-sensitive-endpoint": "error", // or "warn" / "off"
  },
  "rateLimit": {
    "handledAtEdge": false, // true if a gateway/WAF rate-limits for you (suppresses the class)
    "unknownGuard": "flag", // "flag" (default, surfaced for review) or "suppress"
  },
  "suppressions": {
    "requireReason": true, // a suppression without a reason is itself reported
    "allowBlanket": true, // allow rule-less (all-rule) suppressions
  },
}
```

### When to use which

- A specific route is genuinely covered by something Tallyguard can't see (an edge limiter, a
  custom-named guard): an **inline suppression with a reason** on that route.
- Rate limiting is handled at the edge for the whole app: `rateLimit.handledAtEdge: true`.
- You catalogue a custom limiter so it stops being "unknown": prefer that over blanket
  suppression, or set `unknownGuard: "suppress"` if you accept the recall trade.

See [what Tallyguard detects and its limits](detection-and-limits.md) for the cases that lead
to a suppression in the first place.
