// SPDX-License-Identifier: Apache-2.0
// Full scan pipeline: analyze -> inline suppressions -> config. Returns active findings plus all
// surfaced suppressions (inline + config), and a coverage summary of what was actually analyzed
// (D063). `scanProject` is the sync JS/TS path; `scanProjectAsync` also runs the Python (FastAPI)
// analyzer, which is async because its parser grammar loads asynchronously. The suppression +
// config tail is shared (and comment-syntax-agnostic, so Python `# tallyguard-disable` directives
// are honored too).

import { analyzeProjectDetailed } from "./core/analyze.js";
import type { JsAnalysis } from "./core/analyze.js";
import { analyzePythonProjectDetailed } from "./core/python/analyze.js";
import { applyConfig } from "./config.js";
import { applyInlineSuppressions } from "./suppress.js";
import type { TallyguardConfig } from "./config.js";
import type {
  AnalyzerOptions,
  CoverageSummary,
  Finding,
  RuleId,
  ScanResult,
} from "./core/types.js";

/** The rules that actually run today (D063). `money/check-then-act-race` is defined but not
 *  built (D046), so it is deliberately not listed: "rules applied" must never overclaim. */
const BUILT_RULES: readonly RuleId[] = [
  "rate-limit/unprotected-sensitive-endpoint",
  "money/missing-idempotency-key",
  "secrets/client-exposed-secret",
  "secrets/client-side-api-call",
];

function jsAnalysis(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): JsAnalysis {
  return analyzeProjectDetailed(rootDir, {
    unknownGuard: options?.unknownGuard ?? config.rateLimit.unknownGuard,
    maxDepth: options?.maxDepth ?? config.graph.maxDepth,
  });
}

function buildCoverage(
  js: JsAnalysis,
  pyEndpoints: number,
  config: TallyguardConfig,
): CoverageSummary {
  const frameworks = [
    { name: "Next.js App Router", endpoints: js.nextEndpoints },
    { name: "Express", endpoints: js.expressEndpoints },
    { name: "FastAPI", endpoints: pyEndpoints },
  ].filter((f) => f.endpoints > 0);
  return {
    frameworks,
    endpoints: frameworks.reduce((n, f) => n + f.endpoints, 0),
    rulesApplied: BUILT_RULES.filter((r) => config.rules[r] !== "off"),
  };
}

function finalize(
  rootDir: string,
  raw: Finding[],
  config: TallyguardConfig,
  coverage: CoverageSummary,
): ScanResult {
  const inline = applyInlineSuppressions(rootDir, raw, {
    requireReason: config.suppressions.requireReason,
    allowBlanket: config.suppressions.allowBlanket,
  });
  // Inline-surviving findings plus any diagnostics the pass raised go through config
  // (rule levels, edge handling); inline suppressions are merged into the final result.
  const configResult = applyConfig([...inline.active, ...inline.extra], config);
  return {
    findings: configResult.findings,
    suppressed: [...inline.suppressed, ...configResult.suppressed],
    coverage,
  };
}

/** Synchronous JS/TS scan (Next.js / Express). Used by direct callers that cannot await; its
 *  coverage reflects the JS/TS surfaces only (no FastAPI). */
export function scanProject(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): ScanResult {
  const js = jsAnalysis(rootDir, config, options);
  return finalize(rootDir, js.findings, config, buildCoverage(js, 0, config));
}

/** Full scan including the Python (FastAPI) analyzer. Async because the Python parser loads its
 *  grammar asynchronously (once, cached). This is what `tallyguard scan` and the GitHub App run. */
export async function scanProjectAsync(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): Promise<ScanResult> {
  const js = jsAnalysis(rootDir, config, options);
  const py = await analyzePythonProjectDetailed(rootDir);
  const coverage = buildCoverage(js, py.endpoints, config);
  return finalize(rootDir, [...js.findings, ...py.findings], config, coverage);
}
