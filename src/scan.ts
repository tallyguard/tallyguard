// SPDX-License-Identifier: Apache-2.0
// Full scan pipeline: analyze -> inline suppressions -> config. Returns active findings
// plus all surfaced suppressions (inline + config). This is what the CLI runs.

import { analyzeProject } from "./core/analyze.js";
import { applyConfig } from "./config.js";
import { applyInlineSuppressions } from "./suppress.js";
import type { TallyguardConfig } from "./config.js";
import type { AnalyzerOptions, ScanResult } from "./core/types.js";

export function scanProject(
  rootDir: string,
  config: TallyguardConfig,
  options?: AnalyzerOptions,
): ScanResult {
  const raw = analyzeProject(rootDir, {
    unknownGuard: options?.unknownGuard ?? config.rateLimit.unknownGuard,
    maxDepth: options?.maxDepth ?? config.graph.maxDepth,
  });
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
