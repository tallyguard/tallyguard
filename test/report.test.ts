// Reporter tests: JSON shape, SARIF 2.1.0 structural validity, terminal NO_COLOR behavior.

import { describe, it, expect } from "vitest";
import { buildJsonReport, formatJson } from "../src/report/json.js";
import { buildSarif } from "../src/report/sarif.js";
import { formatTerminal } from "../src/report/terminal.js";
import type { ScanResult } from "../src/index.js";

const sample: ScanResult = {
  findings: [
    {
      rule: "rate-limit/unprotected-sensitive-endpoint",
      file: "app/api/chat/route.ts",
      line: 7,
      severity: "error",
      message: "POST /api/chat reaches a sensitive sink (ai) with no rate limiter.",
      sink: "ai",
    },
  ],
  suppressed: [
    {
      rule: "rate-limit/unprotected-sensitive-endpoint",
      file: "app/api/edge/route.ts",
      line: 3,
      severity: "error",
      message: "edge route",
      sink: "ai",
      suppression: { by: "config", reason: "rate limiting handled at the edge" },
    },
  ],
};

describe("JSON reporter", () => {
  it("has a stable shape with summary counts", () => {
    const report = buildJsonReport(sample, "1.2.3");
    expect(report.version).toBe(1);
    expect(report.tool).toEqual({ name: "tallyguard", version: "1.2.3" });
    expect(report.summary).toEqual({ findings: 1, errors: 1, warnings: 0, suppressed: 1 });
    expect(report.findings).toHaveLength(1);
    expect(report.suppressed[0]?.suppression.reason).toContain("edge");
  });
  it("formats valid JSON", () => {
    expect(() => JSON.parse(formatJson(sample, "1.2.3"))).not.toThrow();
  });
});

describe("SARIF reporter", () => {
  it("is structurally valid SARIF 2.1.0 with CWE tags and a suppression", () => {
    const sarif = buildSarif(sample, "1.2.3") as {
      $schema: string;
      version: string;
      runs: Array<{
        tool: {
          driver: { name: string; rules: Array<{ id: string; properties: { tags: string[] } }> };
        };
        results: Array<{
          ruleId: string;
          ruleIndex: number;
          level: string;
          message: { text: string };
          locations: Array<{
            physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
          }>;
          suppressions?: Array<{ kind: string }>;
        }>;
      }>;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toContain("sarif");
    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe("Tallyguard");
    expect(run.tool.driver.rules[0]?.properties.tags).toContain("external/cwe/cwe-799");
    expect(run.results).toHaveLength(2);
    const active = run.results[0]!;
    expect(active.ruleId).toBe("rate-limit/unprotected-sensitive-endpoint");
    expect(active.level).toBe("error");
    expect(active.locations[0]?.physicalLocation.region.startLine).toBe(7);
    // The suppressed finding is present with a suppressions entry (never dropped, D023).
    const suppressed = run.results[1]!;
    expect(suppressed.suppressions?.[0]?.kind).toBe("external");
  });
});

describe("terminal reporter", () => {
  it("omits ANSI codes when color is off", () => {
    const out = formatTerminal(sample, { color: false });
    expect(out).not.toContain("[");
    expect(out).toContain("app/api/chat/route.ts:7");
    expect(out).toContain("1 finding(s): 1 error");
  });
  it("includes ANSI codes when color is on", () => {
    const out = formatTerminal(sample, { color: true });
    expect(out).toContain("[");
  });
});
