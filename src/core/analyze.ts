// SPDX-License-Identifier: Apache-2.0
// Orchestration: build the model for a project directory and run the detectors.

import { buildModel } from "./model.js";
import { detectRateLimit } from "./detector.js";
import { detectMissingIdempotency } from "./detector-money.js";
import type { AnalyzerOptions, Finding } from "./types.js";

/** Analyze a project rooted at `rootDir` and return all findings. */
export function analyzeProject(rootDir: string, options?: AnalyzerOptions): Finding[] {
  const model = buildModel(rootDir, { maxDepth: options?.maxDepth ?? 2 });
  return [...detectRateLimit(model, options), ...detectMissingIdempotency(model)];
}
