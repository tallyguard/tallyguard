// Inline suppression tests: each directive form, requireReason, and allowBlanket.
// Builds tiny temp projects with a vulnerable LLM route and runs the full scan.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanProject } from "../src/index.js";
import type { TallyguardConfig } from "../src/index.js";

const RULE = "rate-limit/unprotected-sensitive-endpoint";

const defaultConfig: TallyguardConfig = {
  rules: {},
  rateLimit: { handledAtEdge: false, unknownGuard: "flag" },
  suppressions: { requireReason: true, allowBlanket: true },
  graph: { maxDepth: 2 },
};

// `body` is spliced just above the POST handler; use {{INLINE}} on the export line.
function project(handlerLineComment: string, aboveHandler: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-supp-"));
  const routeDir = join(dir, "app", "api", "chat");
  mkdirSync(routeDir, { recursive: true });
  const src = `import OpenAI from "openai";
const openai = new OpenAI();
${aboveHandler}
export async function POST(req: Request) {${handlerLineComment}
  const r = await openai.chat.completions.create({ model: "x", messages: [] });
  return Response.json({ r });
}
`;
  writeFileSync(join(routeDir, "route.ts"), src);
  return dir;
}

describe("inline suppression directives", () => {
  it("disable-next-line with a reason suppresses the finding", () => {
    const dir = project("", `// tallyguard-disable-next-line ${RULE} -- handled at the gateway`);
    const r = scanProject(dir, defaultConfig);
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
    expect(r.suppressed[0]?.suppression).toMatchObject({
      by: "inline",
      reason: "handled at the gateway",
    });
  });

  it("disable-line on the handler line suppresses the finding", () => {
    const dir = project(` // tallyguard-disable-line ${RULE} -- internal only`, "");
    const r = scanProject(dir, defaultConfig);
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
  });

  it("disable-file suppresses findings in the file", () => {
    const dir = project(
      "",
      `// tallyguard-disable-file ${RULE} -- admin tool, not internet-facing`,
    );
    const r = scanProject(dir, defaultConfig);
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
  });

  it("a disable/enable block suppresses findings inside it", () => {
    const dir = project("", `// tallyguard-disable ${RULE} -- see RFC-12\n// (block continues)`);
    const r = scanProject(dir, defaultConfig);
    // The block is never closed, so it extends to EOF and covers the handler.
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
  });

  it("requireReason raises suppression-without-reason when the reason is missing", () => {
    const dir = project("", `// tallyguard-disable-next-line ${RULE}`);
    const r = scanProject(dir, defaultConfig);
    // The original finding is suppressed, and a warning about the missing reason is raised.
    expect(r.suppressed.some((f) => f.rule === RULE)).toBe(true);
    expect(r.findings.map((f) => f.rule)).toContain("tallyguard/suppression-without-reason");
    expect(
      r.findings.find((f) => f.rule === "tallyguard/suppression-without-reason")?.severity,
    ).toBe("warning");
  });

  it("requireReason=false allows a reasonless suppression with no warning", () => {
    const dir = project("", `// tallyguard-disable-next-line ${RULE}`);
    const cfg: TallyguardConfig = {
      ...defaultConfig,
      suppressions: { requireReason: false, allowBlanket: true },
    };
    const r = scanProject(dir, cfg);
    expect(r.findings).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
  });

  it("allowBlanket=false ignores a blanket (rule-less) directive", () => {
    const dir = project("", `// tallyguard-disable-next-line -- blanket attempt`);
    const cfg: TallyguardConfig = {
      ...defaultConfig,
      suppressions: { requireReason: true, allowBlanket: false },
    };
    const r = scanProject(dir, cfg);
    // Blanket not allowed, so the finding stays active.
    expect(r.findings.some((f) => f.rule === RULE)).toBe(true);
    expect(r.suppressed).toHaveLength(0);
  });

  it("a blanket directive suppresses when allowBlanket is true", () => {
    const dir = project("", `// tallyguard-disable-next-line -- blanket ok`);
    const r = scanProject(dir, defaultConfig);
    expect(r.findings.some((f) => f.rule === RULE)).toBe(false);
    expect(r.suppressed).toHaveLength(1);
  });
});
