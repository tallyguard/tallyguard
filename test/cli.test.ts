// CLI tests: the D016 exit-code contract, output formats, and config-driven suppression.
// runCli is pure (no process I/O), so we drive it directly.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli/index.js";
import type { JsonReport } from "../src/report/json.js";

const here = dirname(fileURLToPath(import.meta.url));
const benchmarkDir = join(here, "..", "benchmark");
const vulnerable = join(benchmarkDir, "cases/rate-limit/llm-openai-unprotected/vulnerable");
const safe = join(benchmarkDir, "cases/rate-limit/llm-openai-unprotected/safe");

const ctx = { cwd: process.cwd(), env: {}, stdoutTTY: false };

describe("CLI exit codes (D016)", async () => {
  it("exits 2 when there are error findings", async () => {
    expect((await runCli(["scan", vulnerable], ctx)).exitCode).toBe(2);
  });
  it("exits 0 on a clean project", async () => {
    expect((await runCli(["scan", safe], ctx)).exitCode).toBe(0);
  });
  it("exits 1 on a missing path", async () => {
    const out = await runCli(["scan", join(here, "does-not-exist")], ctx);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("Not a directory");
  });
});

describe("CLI formats", async () => {
  it("--json emits a parseable report with the finding", async () => {
    const out = await runCli(["scan", vulnerable, "--json"], ctx);
    const report = JSON.parse(out.stdout) as JsonReport;
    expect(report.summary.findings).toBe(1);
    expect(report.findings[0]?.rule).toBe("rate-limit/unprotected-sensitive-endpoint");
  });
  it("--sarif emits SARIF 2.1.0", async () => {
    const out = await runCli(["scan", vulnerable, "--sarif"], ctx);
    const sarif = JSON.parse(out.stdout) as { version: string; runs: unknown[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
  });
  it("terminal output has no ANSI when stdout is not a TTY", async () => {
    const out = await runCli(["scan", vulnerable], ctx);
    expect(out.stdout).not.toContain("[");
  });
  it("--version exits 0", async () => {
    expect((await runCli(["--version"], ctx)).exitCode).toBe(0);
  });
});

describe("CLI branches", async () => {
  it("prints usage and exits 0 with no args", async () => {
    const out = await runCli([], ctx);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Usage");
  });
  it("rejects an unknown command", async () => {
    const out = await runCli(["frobnicate", vulnerable], ctx);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("Unknown command");
  });
  it("rejects an unknown format", async () => {
    const out = await runCli(["scan", vulnerable, "--format", "xml"], ctx);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("Unknown format");
  });
  it("terminal output names the finding and a summary", async () => {
    const out = await runCli(["scan", vulnerable], ctx);
    expect(out.stdout).toContain("rate-limit/unprotected-sensitive-endpoint");
    expect(out.stdout).toContain("finding(s)");
  });
  it("exits 1 on an invalid config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-cli-"));
    const cfg = join(dir, "bad.json");
    writeFileSync(cfg, JSON.stringify({ version: 1, rateLimit: { handledAtEdg: true } }));
    const out = await runCli(["scan", vulnerable, "--config", cfg], ctx);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("Invalid config");
  });
  it("rejects an invalid --max-depth", async () => {
    const out = await runCli(["scan", vulnerable, "--max-depth", "abc"], ctx);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("Invalid --max-depth");
  });
  it("--show-suppressed lists a config-suppressed finding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-cli-"));
    const cfg = join(dir, "tallyguard.config.json");
    writeFileSync(
      cfg,
      JSON.stringify({ version: 1, rules: { "rate-limit/unprotected-sensitive-endpoint": "off" } }),
    );
    const out = await runCli(["scan", vulnerable, "--config", cfg, "--show-suppressed"], ctx);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Suppressed");
  });
});

describe("CLI config", async () => {
  it("turning the rule off suppresses the finding and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-cli-"));
    const cfg = join(dir, "tallyguard.config.json");
    writeFileSync(
      cfg,
      JSON.stringify({
        version: 1,
        rules: { "rate-limit/unprotected-sensitive-endpoint": "off" },
      }),
    );
    const out = await runCli(["scan", vulnerable, "--config", cfg, "--json"], ctx);
    expect(out.exitCode).toBe(0);
    const report = JSON.parse(out.stdout) as JsonReport;
    expect(report.summary.findings).toBe(0);
    expect(report.summary.suppressed).toBe(1);
    expect(report.suppressed[0]?.suppression.reason).toContain("disabled");
  });
});

describe("CLI update-check gating (allowUpdateCheck)", async () => {
  const tty = {
    cwd: process.cwd(),
    env: {} as Record<string, string | undefined>,
    stdoutTTY: true,
  };

  it("allows the check on an interactive terminal scan", async () => {
    expect((await runCli(["scan", safe], tty)).allowUpdateCheck).toBe(true);
  });

  it("suppresses for machine output (--json / --sarif)", async () => {
    expect((await runCli(["scan", safe, "--json"], tty)).allowUpdateCheck).toBeFalsy();
    expect((await runCli(["scan", safe, "--sarif"], tty)).allowUpdateCheck).toBeFalsy();
  });

  it("suppresses for a non-TTY pipe", async () => {
    expect(
      (await runCli(["scan", safe], { ...tty, stdoutTTY: false })).allowUpdateCheck,
    ).toBeFalsy();
  });

  it("suppresses with --no-update-check", async () => {
    expect((await runCli(["scan", safe, "--no-update-check"], tty)).allowUpdateCheck).toBeFalsy();
  });

  it("suppresses in CI and on an env opt-out", async () => {
    expect(
      (await runCli(["scan", safe], { ...tty, env: { CI: "true" } })).allowUpdateCheck,
    ).toBeFalsy();
    expect(
      (await runCli(["scan", safe], { ...tty, env: { TALLYGUARD_NO_UPDATE_CHECK: "1" } }))
        .allowUpdateCheck,
    ).toBeFalsy();
  });

  it("suppresses when disabled in config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-upd-"));
    writeFileSync(
      join(dir, "tallyguard.config.json"),
      JSON.stringify({ version: 1, updateCheck: false }),
    );
    expect((await runCli(["scan", dir], tty)).allowUpdateCheck).toBeFalsy();
  });
});

describe("CLI runs the Python (FastAPI) analyzer", () => {
  it("flags an unprotected FastAPI endpoint via the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-pycli-"));
    writeFileSync(
      join(dir, "main.py"),
      `from fastapi import APIRouter
from passlib.context import CryptContext

router = APIRouter()
pwd = CryptContext(schemes=["bcrypt"])

@router.post("/login")
async def login(body):
    return pwd.verify(body.password, "h")
`,
    );
    const out = await runCli(["scan", dir, "--json"], ctx);
    expect(out.exitCode).toBe(2);
    const report = JSON.parse(out.stdout) as JsonReport;
    expect(
      report.findings.some(
        (f) => f.rule === "rate-limit/unprotected-sensitive-endpoint" && f.file === "main.py",
      ),
    ).toBe(true);
  });
});

describe("coverage summary (D063)", () => {
  const fastapiVulnerable = join(benchmarkDir, "cases/fastapi/auth-crossfile/vulnerable");
  const fastapiGlobalLimiter = join(benchmarkDir, "cases/fastapi/global-limiter/safe");

  it("terminal output states endpoints analyzed and rules applied", async () => {
    const out = await runCli(["scan", vulnerable], ctx);
    expect(out.stdout).toContain("Coverage: 1 endpoint(s) analyzed (Next.js App Router 1)");
    expect(out.stdout).toContain("4 rule(s) applied");
  });

  it("says so when no modeled framework matched (silence must not read as clean)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-cov-"));
    writeFileSync(join(dir, "readme.md"), "no code here");
    const out = await runCli(["scan", dir], ctx);
    expect(out.stdout).toContain("Coverage: no modeled framework endpoints found");
    expect(out.stdout).toContain("Next.js App Router, Express, FastAPI");
  });

  it("counts FastAPI endpoints in --json coverage", async () => {
    const out = await runCli(["scan", fastapiVulnerable, "--json"], ctx);
    const report = JSON.parse(out.stdout) as JsonReport;
    expect(report.coverage?.frameworks).toEqual([
      { name: "FastAPI", endpoints: expect.any(Number) as number },
    ]);
    expect(report.coverage?.endpoints).toBeGreaterThan(0);
    expect(report.coverage?.rulesApplied).toContain("rate-limit/unprotected-sensitive-endpoint");
    expect(report.coverage?.rulesApplied).not.toContain("money/check-then-act-race");
  });

  it("still counts endpoints under a FastAPI global limiter (D061: covered, not unscanned)", async () => {
    const out = await runCli(["scan", fastapiGlobalLimiter, "--json"], ctx);
    const report = JSON.parse(out.stdout) as JsonReport;
    expect(report.summary.findings).toBe(0);
    expect(report.coverage?.endpoints).toBeGreaterThan(0);
  });

  it("excludes a config-off rule from rulesApplied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-covcfg-"));
    writeFileSync(
      join(dir, "tallyguard.config.json"),
      JSON.stringify({ version: 1, rules: { "money/missing-idempotency-key": "off" } }),
    );
    const out = await runCli(["scan", dir, "--json"], ctx);
    const report = JSON.parse(out.stdout) as JsonReport;
    expect(report.coverage?.rulesApplied).not.toContain("money/missing-idempotency-key");
    expect(report.coverage?.rulesApplied).toHaveLength(3);
  });
});
