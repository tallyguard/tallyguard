// Golden test: run Detector 1 over every benchmark variant and assert the findings
// match the labels in benchmark/manifest.json. This is the Phase 2 correctness proof.
// The manifest is the single source of truth; the test is never weakened to pass.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, analyzePythonProject } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const benchmarkDir = join(here, "..", "benchmark");

interface Expect {
  rule: string;
  file: string;
}
interface Variant {
  kind: string;
  root: string;
  expect?: Expect[];
}
interface Case {
  id: string;
  analyzer?: string;
  variants: Variant[];
}
interface Manifest {
  cases: Case[];
}

const manifest = JSON.parse(readFileSync(join(benchmarkDir, "manifest.json"), "utf8")) as Manifest;

const key = (x: { rule: string; file: string }) => `${x.file}::${x.rule}`;
const norm = (xs: { rule: string; file: string }[]) =>
  xs.map((x) => ({ rule: x.rule, file: x.file })).sort((a, b) => key(a).localeCompare(key(b)));

describe("Detector 1 (rate-limit) on the benchmark", () => {
  for (const c of manifest.cases) {
    for (const v of c.variants) {
      it(`${c.id} [${v.kind}]`, async () => {
        const root = join(benchmarkDir, v.root);
        const findings =
          c.analyzer === "python" ? await analyzePythonProject(root) : analyzeProject(root);
        expect(norm(findings)).toEqual(norm(v.expect ?? []));
      });
    }
  }
});

describe("Detector 1 finding content", () => {
  it("flags the LLM endpoint with error severity and the ai sink", () => {
    const [finding, ...rest] = analyzeProject(
      join(benchmarkDir, "cases/rate-limit/llm-openai-unprotected/vulnerable"),
    );
    expect(rest).toHaveLength(0);
    expect(finding).toMatchObject({
      rule: "rate-limit/unprotected-sensitive-endpoint",
      severity: "error",
      sink: "ai",
    });
  });

  it("names the unrecognized guard in the unknown-guard case", () => {
    const findings = analyzeProject(
      join(benchmarkDir, "cases/rate-limit/unknown-custom-guard/vulnerable"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("withThrottle");
  });

  it("respects unknownGuard=suppress for the unknown-guard case", () => {
    const findings = analyzeProject(
      join(benchmarkDir, "cases/rate-limit/unknown-custom-guard/vulnerable"),
      { unknownGuard: "suppress" },
    );
    expect(findings).toHaveLength(0);
  });
});
