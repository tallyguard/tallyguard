// SPDX-License-Identifier: Apache-2.0
// Core types shared across the analyzer. Kept dependency-free and pure.

/** Stable rule identifiers (see docs/specs/SUPPRESSION-AND-FALSE-POSITIVES.md, D019). */
export type RuleId =
  | "rate-limit/unprotected-sensitive-endpoint"
  | "money/missing-idempotency-key"
  | "money/check-then-act-race"
  | "secrets/client-exposed-secret"
  | "secrets/client-side-api-call"
  | "tallyguard/suppression-without-reason";

export type Severity = "error" | "warning" | "info";

/** Categories of sensitive/expensive sink an endpoint may reach (project plan Appendix A). */
export type SinkCategory = "ai" | "auth" | "email" | "sms";

/** A single finding emitted by a detector. */
export interface Finding {
  readonly rule: RuleId;
  /** File path relative to the scanned project root, e.g. "app/api/chat/route.ts". */
  readonly file: string;
  readonly line: number;
  readonly severity: Severity;
  readonly message: string;
  /** The sink that made the endpoint sensitive, when applicable. */
  readonly sink?: SinkCategory;
}

/** How to treat a route guarded by a limiter the catalogue does not recognize (D024). */
export type UnknownGuardPolicy = "flag" | "suppress";

export interface AnalyzerOptions {
  /** Defaults to "flag" per D024. */
  readonly unknownGuard?: UnknownGuardPolicy;
  /** Call-graph depth followed from a handler into helpers. Defaults to 2. */
  readonly maxDepth?: number;
}

export interface AnalyzerResult {
  readonly findings: Finding[];
}

/** Why a finding was suppressed (recorded, never silently dropped, per D023). */
export interface Suppression {
  readonly by: "config" | "inline";
  readonly reason: string;
}

export interface SuppressedFinding extends Finding {
  readonly suppression: Suppression;
}

/** The result of a scan after config is applied: active findings plus surfaced suppressions. */
export interface ScanResult {
  readonly findings: Finding[];
  readonly suppressed: SuppressedFinding[];
}
