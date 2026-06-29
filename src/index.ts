// SPDX-License-Identifier: Apache-2.0
// Public API of the Tallyguard analyzer core.

export { analyzeProject } from "./core/analyze.js";
export { buildModel } from "./core/model.js";
export { detectRateLimit } from "./core/detector.js";
export { detectMissingIdempotency } from "./core/detector-money.js";
export { RULE_METADATA } from "./core/rules-meta.js";
export type { RuleMeta } from "./core/rules-meta.js";
export { loadConfig, applyConfig } from "./config.js";
export type { TallyguardConfig, RuleLevel } from "./config.js";
export { scanProject, scanProjectAsync } from "./scan.js";
export { analyzePythonProject } from "./core/python/analyze.js";
export { applyInlineSuppressions, parseDirectives } from "./suppress.js";
export type { InlineOptions, InlineResult } from "./suppress.js";
export { reviewDirectory, reviewToResult } from "./app/review.js";
export type { ReviewResult, Annotation } from "./app/review.js";
export { reviewPullRequest } from "./app/handler.js";
export type { ReviewDeps, PullRequestRef, CheckRunInput } from "./app/handler.js";
export { verifyWebhookSignature } from "./app/webhook.js";
export { formatJson, buildJsonReport } from "./report/json.js";
export { formatSarif, buildSarif } from "./report/sarif.js";
export { formatTerminal } from "./report/terminal.js";
export type {
  Finding,
  RuleId,
  Severity,
  SinkCategory,
  AnalyzerOptions,
  AnalyzerResult,
  UnknownGuardPolicy,
  Suppression,
  SuppressedFinding,
  ScanResult,
} from "./core/types.js";
export type { ProjectModel, RouteModel, MiddlewareModel, StripeCreateCall } from "./core/model.js";
