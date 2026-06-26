// Cross-file reachability safety (audit AU4/AU5): depth bounding, cycle termination,
// node_modules exclusion, and the static-only invariant.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { analyzeProject, scanProject } from "../src/index.js";
import type { TallyguardConfig } from "../src/index.js";

const configWithDepth = (maxDepth: number): TallyguardConfig => ({
  rules: {},
  rateLimit: { handledAtEdge: false, unknownGuard: "flag" },
  suppressions: { requireReason: true, allowBlanket: true },
  graph: { maxDepth },
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-reach-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const sinkHelper = (extra = "") =>
  `import OpenAI from "openai";\nconst o = new OpenAI();\n${extra}\nexport async function leaf() { await o.chat.completions.create({ model: "x", messages: [] }); }\n`;

describe("cross-file reachability", () => {
  it("finds a sink two hops away at the default depth", () => {
    const dir = project({
      "app/api/chat/route.ts":
        'import { a } from "../../../lib/a";\nexport async function POST() { await a(); return Response.json({}); }\n',
      "lib/a.ts": 'import { leaf } from "./b";\nexport async function a() { return leaf(); }\n',
      "lib/b.ts": sinkHelper(),
    });
    expect(analyzeProject(dir)).toHaveLength(1);
  });

  it("respects the maxDepth bound (does not reach beyond it)", () => {
    const dir = project({
      "app/api/chat/route.ts":
        'import { a } from "../../../lib/a";\nexport async function POST() { await a(); return Response.json({}); }\n',
      "lib/a.ts": 'import { leaf } from "./b";\nexport async function a() { return leaf(); }\n',
      "lib/b.ts": sinkHelper(),
    });
    // The sink is two hops away; depth 1 must not reach it.
    expect(analyzeProject(dir, { maxDepth: 1 })).toHaveLength(0);
  });

  it("honors config graph.maxDepth through scanProject", () => {
    const files = {
      "app/api/chat/route.ts":
        'import { a } from "../../../lib/a";\nexport async function POST() { await a(); return Response.json({}); }\n',
      "lib/a.ts": 'import { leaf } from "./b";\nexport async function a() { return leaf(); }\n',
      "lib/b.ts": sinkHelper(),
    };
    expect(scanProject(project(files), configWithDepth(2)).findings).toHaveLength(1);
    expect(scanProject(project(files), configWithDepth(1)).findings).toHaveLength(0);
  });

  it("terminates on a helper cycle and still reports the sink", () => {
    const dir = project({
      "app/api/chat/route.ts":
        'import { a } from "../../../lib/a";\nexport async function POST() { await a(); return Response.json({}); }\n',
      // a has the sink and calls b; b calls a (cycle). The visited set must prevent a hang.
      "lib/a.ts":
        'import OpenAI from "openai";\nimport { b } from "./b";\nconst o = new OpenAI();\nexport async function a() { await o.chat.completions.create({ model: "x", messages: [] }); return b(); }\n',
      "lib/b.ts": 'import { a } from "./a";\nexport async function b() { return a(); }\n',
    });
    expect(analyzeProject(dir)).toHaveLength(1);
  });

  it("does not scan node_modules", () => {
    const dir = project({
      "app/api/chat/route.ts": sinkRoute(),
      // A route-shaped file inside a dependency must be ignored.
      "node_modules/evil/app/api/x/route.ts": sinkRoute(),
    });
    const findings = analyzeProject(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("app/api/chat/route.ts");
  });

  it("never executes the target code (static-only invariant)", () => {
    const dir = project({
      // If the analyzer required/eval'd this module, the top-level throw would blow up.
      "app/api/chat/route.ts": `throw new Error("must not execute");\n${sinkRoute()}`,
    });
    expect(() => analyzeProject(dir)).not.toThrow();
    expect(analyzeProject(dir)).toHaveLength(1);
  });
});

function sinkRoute(): string {
  return 'import OpenAI from "openai";\nconst openai = new OpenAI();\nexport async function POST() { await openai.chat.completions.create({ model: "x", messages: [] }); return Response.json({}); }\n';
}
