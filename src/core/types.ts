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

/** A modeled framework surface that matched in the scanned project. */
export interface FrameworkCoverage {
  /** Display name, e.g. "Next.js App Router", "Express", "FastAPI". */
  readonly name: string;
  /** Endpoints analyzed on this surface (routes + server actions + credential callbacks). */
  readonly endpoints: number;
}

/** What the scan actually looked at (D063). Printed with every report so a clean result is
 *  auditable: "0 findings over 12 endpoints" and "0 findings, nothing modeled" are different
 *  answers, and silence on an unmodeled framework must not read as a clean bill. */
export interface CoverageSummary {
  /** Framework surfaces that matched, with endpoint counts. Empty = none modeled here. */
  readonly frameworks: readonly FrameworkCoverage[];
  /** Total endpoints analyzed across all surfaces. */
  readonly endpoints: number;
  /** Rules that ran (the built rules minus any configured "off"). */
  readonly rulesApplied: readonly RuleId[];
}

/** The result of a scan after config is applied: active findings plus surfaced suppressions. */
export interface ScanResult {
  readonly findings: Finding[];
  readonly suppressed: SuppressedFinding[];
  /** Present on results produced by scanProject/scanProjectAsync; optional for compatibility. */
  readonly coverage?: CoverageSummary;
}
