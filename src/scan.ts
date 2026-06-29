// SPDX-License-Identifier: Apache-2.0
// Full scan pipeline: analyze -> inline suppressions -> config. Returns active findings plus all
// surfaced suppressions (inline + config). `scanProject` is the sync JS/TS path; `scanProjectAsync`
// also runs the Python (FastAPI) analyzer, which is async because its parser grammar loads
// asynchronously. The suppression + config tail is shared (and comment-syntax-agnostic, so Python
// `# tallyguard-disable` directives are honored too).

import { analyzeProject } from "./core/analyze.js";
import { analyzePythonProject } from "./core/python/analyze.js";
import { applyConfig } from "./config.js";
import { applyInlineSuppressions } from "./suppress.js";
import type { TallyguardConfig } from "./config.js";
import type { AnalyzerOptions, Finding, ScanResult } from "./core/types.js";

function jsFindings(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): Finding[] {
  return analyzeProject(rootDir, {
    unknownGuard: options?.unknownGuard ?? config.rateLimit.unknownGuard,
    maxDepth: options?.maxDepth ?? config.graph.maxDepth,
  });
}

function finalize(rootDir: string, raw: Finding[], config: TallyguardConfig): ScanResult {
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
  };
}

/** Synchronous JS/TS scan (Next.js / Express). Used by the GitHub App and direct callers. */
export function scanProject(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): ScanResult {
  return finalize(rootDir, jsFindings(rootDir, config, options), config);
}

/** Full scan including the Python (FastAPI) analyzer. Async because the Python parser loads its
 *  grammar asynchronously (once, cached). This is what `tallyguard scan` runs. */
export async function scanProjectAsync(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): Promise<ScanResult> {
  const raw = [...jsFindings(rootDir, config, options), ...(await analyzePythonProject(rootDir))];
  return finalize(rootDir, raw, config);
}
