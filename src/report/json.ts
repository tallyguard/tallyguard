// SPDX-License-Identifier: Apache-2.0
// JSON reporter. A versioned, stable integration contract (DESIGN-STANDARD Section 5).

import type { CoverageSummary, ScanResult } from "../core/types.js";

export interface JsonReport {
  readonly version: 1;
  readonly tool: { readonly name: string; readonly version: string };
  readonly summary: {
    readonly findings: number;
    readonly errors: number;
    readonly warnings: number;
    readonly suppressed: number;
  };
  /** What the scan analyzed (D063). Additive since 0.7.0; absent from older reports. */
  readonly coverage?: CoverageSummary;
  readonly findings: ScanResult["findings"];
  readonly suppressed: ScanResult["suppressed"];
}

export function buildJsonReport(result: ScanResult, toolVersion: string): JsonReport {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  return {
    version: 1,
    tool: { name: "tallyguard", version: toolVersion },
    summary: {
      findings: result.findings.length,
      errors,
      warnings,
      suppressed: result.suppressed.length,
    },
    ...(result.coverage ? { coverage: result.coverage } : {}),
    findings: result.findings,
    suppressed: result.suppressed,
  };
}

export function formatJson(result: ScanResult, toolVersion: string): string {
  return JSON.stringify(buildJsonReport(result, toolVersion), null, 2) + "\n";
}
