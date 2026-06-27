// SPDX-License-Identifier: Apache-2.0
// Stable rule metadata for reporting (SARIF rule objects, CWE tags, help links).
// CWE mappings per feedback-4 Section 2 and the suppression spec (D019).

import type { RuleId } from "./types.js";

export interface RuleMeta {
  readonly id: RuleId;
  readonly name: string;
  readonly shortDescription: string;
  /** CWE identifiers, e.g. "CWE-799". Empty when none is confidently sourced. */
  readonly cwe: string[];
  readonly helpUri: string;
}

const HELP_BASE = "https://tallyguard.dev/rules";

export const RULE_METADATA: Readonly<Record<RuleId, RuleMeta>> = {
  "rate-limit/unprotected-sensitive-endpoint": {
    id: "rate-limit/unprotected-sensitive-endpoint",
    name: "UnprotectedSensitiveEndpoint",
    shortDescription:
      "A sensitive or expensive endpoint has no rate limiter reachable on its route.",
    cwe: ["CWE-799", "CWE-770", "CWE-400", "CWE-307"],
    helpUri: `${HELP_BASE}/rate-limit/unprotected-sensitive-endpoint`,
  },
  "money/missing-idempotency-key": {
    id: "money/missing-idempotency-key",
    name: "MissingIdempotencyKey",
    shortDescription: "A payment charge/credit call is missing an idempotency key.",
    // CWE deliberately unset until a primary source is confirmed (D019).
    cwe: [],
    helpUri: `${HELP_BASE}/money/missing-idempotency-key`,
  },
  "money/check-then-act-race": {
    id: "money/check-then-act-race",
    name: "CheckThenActRace",
    shortDescription: "A read-modify-write on a balance/counter without an atomic guard.",
    cwe: ["CWE-367", "CWE-362"],
    helpUri: `${HELP_BASE}/money/check-then-act-race`,
  },
  "secrets/client-exposed-secret": {
    id: "secrets/client-exposed-secret",
    name: "ClientExposedSecret",
    shortDescription:
      "A secret-named NEXT_PUBLIC_ env var is inlined into the client bundle and exposed to the browser.",
    cwe: ["CWE-200"],
    helpUri: `${HELP_BASE}/secrets/client-exposed-secret`,
  },
  "secrets/client-side-api-call": {
    id: "secrets/client-side-api-call",
    name: "ClientSideSecretApiCall",
    shortDescription:
      "A paid/secret API (an LLM host) is called from client-side code, exposing its key and inviting denial-of-wallet.",
    cwe: ["CWE-200", "CWE-522"],
    helpUri: `${HELP_BASE}/secrets/client-side-api-call`,
  },
  "tallyguard/suppression-without-reason": {
    id: "tallyguard/suppression-without-reason",
    name: "SuppressionWithoutReason",
    shortDescription: "A suppression directive has no ' -- <reason>' (requireReason is on).",
    cwe: [],
    helpUri: `${HELP_BASE}/tallyguard/suppression-without-reason`,
  },
};
