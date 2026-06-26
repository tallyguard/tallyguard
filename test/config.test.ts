// Config loading + validation (audit AU2): typos and invalid values must be rejected.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/index.js";

function withConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-cfg-"));
  writeFileSync(join(dir, "tallyguard.config.json"), content);
  return dir;
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const cfg = loadConfig(mkdtempSync(join(tmpdir(), "tg-cfg-")));
    expect(cfg.rateLimit.unknownGuard).toBe("flag");
    expect(cfg.suppressions.requireReason).toBe(true);
  });

  it("reads a valid config", () => {
    const dir = withConfig(
      JSON.stringify({
        version: 1,
        rules: { "rate-limit/unprotected-sensitive-endpoint": "warn" },
        rateLimit: { unknownGuard: "suppress" },
        suppressions: { requireReason: false },
      }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.rules["rate-limit/unprotected-sensitive-endpoint"]).toBe("warn");
    expect(cfg.rateLimit.unknownGuard).toBe("suppress");
    expect(cfg.suppressions.requireReason).toBe(false);
  });

  it("throws on an invalid rule level (typo)", () => {
    const dir = withConfig(
      JSON.stringify({ version: 1, rules: { "rate-limit/unprotected-sensitive-endpoint": "of" } }),
    );
    expect(() => loadConfig(dir)).toThrow(/Invalid config/);
  });

  it("throws on an unknown key (typo)", () => {
    const dir = withConfig(JSON.stringify({ version: 1, rateLimit: { handledAtEdg: true } }));
    expect(() => loadConfig(dir)).toThrow(/Invalid config/);
  });

  it("throws on an unknown rule id", () => {
    const dir = withConfig(JSON.stringify({ version: 1, rules: { "made-up/rule": "off" } }));
    expect(() => loadConfig(dir)).toThrow(/Invalid config/);
  });

  it("throws on malformed JSON", () => {
    const dir = withConfig("{ not valid json");
    expect(() => loadConfig(dir)).toThrow(/Invalid config/);
  });

  it("reads graph.maxDepth", () => {
    const dir = withConfig(JSON.stringify({ version: 1, graph: { maxDepth: 3 } }));
    expect(loadConfig(dir).graph.maxDepth).toBe(3);
  });

  it("throws on an unknown graph key", () => {
    const dir = withConfig(JSON.stringify({ version: 1, graph: { depth: 3 } }));
    expect(() => loadConfig(dir)).toThrow(/Invalid config/);
  });
});
