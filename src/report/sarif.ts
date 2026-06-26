// SPDX-License-Identifier: Apache-2.0
// SARIF 2.1.0 reporter. The only version GitHub code scanning accepts (DESIGN-STANDARD
// Section 5). Suppressed findings are emitted with a `suppressions` entry, never dropped
// (D023). CWEs are attached as `external/cwe/cwe-NNN` tags, GitHub's convention.

import type { ScanResult, Severity, Finding, SuppressedFinding } from "../core/types.js";
import { RULE_METADATA } from "../core/rules-meta.js";

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

function sarifLevel(severity: Severity): "error" | "warning" | "note" {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "note";
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }>;
  suppressions?: Array<{ kind: "external" | "inSource" }>;
}

export function buildSarif(result: ScanResult, toolVersion: string): unknown {
  // Stable rule index for every rule referenced by any finding.
  const referenced = [
    ...new Set([...result.findings.map((f) => f.rule), ...result.suppressed.map((f) => f.rule)]),
  ];
  const ruleIndex = new Map(referenced.map((id, i) => [id, i]));
  const rules = referenced.map((id) => {
    const meta = RULE_METADATA[id];
    return {
      id,
      name: meta.name,
      shortDescription: { text: meta.shortDescription },
      helpUri: meta.helpUri,
      properties: {
        tags: ["security", ...meta.cwe.map((c) => `external/cwe/${c.toLowerCase()}`)],
      },
    };
  });

  const toResult = (f: Finding, suppressed: boolean): SarifResult => {
    const base: SarifResult = {
      ruleId: f.rule,
      ruleIndex: ruleIndex.get(f.rule) ?? 0,
      level: sarifLevel(f.severity),
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: { startLine: f.line },
          },
        },
      ],
    };
    return suppressed ? { ...base, suppressions: [{ kind: "external" }] } : base;
  };

  const results: SarifResult[] = [
    ...result.findings.map((f) => toResult(f, false)),
    ...result.suppressed.map((f: SuppressedFinding) => toResult(f, true)),
  ];

  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Tallyguard",
            informationUri: "https://tallyguard.dev",
            version: toolVersion,
            rules,
          },
        },
        results,
      },
    ],
  };
}

export function formatSarif(result: ScanResult, toolVersion: string): string {
  return JSON.stringify(buildSarif(result, toolVersion), null, 2) + "\n";
}
