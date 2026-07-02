// SPDX-License-Identifier: Apache-2.0
// Orchestration: build the model for a project directory and run the detectors.

import { buildModel } from "./model.js";
import { detectRateLimit } from "./detector.js";
import { detectMissingIdempotency } from "./detector-money.js";
import { detectClientExposedSecrets, detectClientSideApiCalls } from "./detector-secrets.js";
import type { AnalyzerOptions, Finding } from "./types.js";

/** Findings plus what the JS/TS model actually covered (for the coverage summary, D063). */
export interface JsAnalysis {
  readonly findings: Finding[];
  /** Next.js App Router endpoints analyzed: routes + server actions + credential callbacks. */
  readonly nextEndpoints: number;
  /** Express route registrations analyzed. */
  readonly expressEndpoints: number;
}

/** Analyze a project rooted at `rootDir`: findings plus per-framework endpoint counts. */
export function analyzeProjectDetailed(rootDir: string, options?: AnalyzerOptions): JsAnalysis {
  const model = buildModel(rootDir, { maxDepth: options?.maxDepth ?? 2 });
  const findings = [
    ...detectRateLimit(model, options),
    ...detectMissingIdempotency(model),
    ...detectClientExposedSecrets(model),
    ...detectClientSideApiCalls(model),
  ];
  return {
    findings,
    nextEndpoints: model.routes.filter((r) => r.framework === "next").length,
    expressEndpoints: model.routes.filter((r) => r.framework === "express").length,
  };
}

/** Analyze a project rooted at `rootDir` and return all findings. */
export function analyzeProject(rootDir: string, options?: AnalyzerOptions): Finding[] {
  return analyzeProjectDetailed(rootDir, options).findings;
}
