// SPDX-License-Identifier: Apache-2.0
// Focused unit coverage for Detector 3 (secrets/client-exposed-secret), including the Vite
// (`import.meta.env.VITE_*`) surface alongside Next.js (`process.env.NEXT_PUBLIC_*`).
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { analyzeProject } from "../src/index.js";
import { isClientExposedSecretName } from "../src/core/catalogues.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-secrets-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const exposed = (dir: string) =>
  analyzeProject(dir).filter((f) => f.rule === "secrets/client-exposed-secret");

describe("isClientExposedSecretName", () => {
  it("flags an unambiguous secret under either client-exposed prefix (NEXT_PUBLIC_ or VITE_)", () => {
    expect(isClientExposedSecretName("NEXT_PUBLIC_STRIPE_SECRET_KEY")).toBe(true);
    expect(isClientExposedSecretName("VITE_STRIPE_SECRET_KEY")).toBe(true);
    expect(isClientExposedSecretName("VITE_SUPABASE_SERVICE_ROLE_KEY")).toBe(true);
    expect(isClientExposedSecretName("VITE_OPENAI_API_KEY")).toBe(true);
  });

  it("does not flag legitimately-public client vars", () => {
    expect(isClientExposedSecretName("VITE_STRIPE_PUBLISHABLE_KEY")).toBe(false);
    expect(isClientExposedSecretName("VITE_SUPABASE_ANON_KEY")).toBe(false);
    expect(isClientExposedSecretName("VITE_API_BASE_URL")).toBe(false);
    expect(isClientExposedSecretName("NEXT_PUBLIC_POSTHOG_KEY")).toBe(false);
  });

  it("does not flag a server-only var (no client-exposed prefix)", () => {
    expect(isClientExposedSecretName("STRIPE_SECRET_KEY")).toBe(false);
    expect(isClientExposedSecretName("OPENAI_API_KEY")).toBe(false);
  });
});

describe("secrets/client-exposed-secret over a project", () => {
  it("flags a Vite VITE_<secret> read via import.meta.env", () => {
    const dir = project({
      "src/config.ts": "export const k = import.meta.env.VITE_STRIPE_SECRET_KEY;\n",
    });
    const findings = exposed(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/config.ts");
  });

  it("flags a Next NEXT_PUBLIC_<secret> read via process.env", () => {
    const dir = project({
      "lib/env.ts": "export const k = process.env.NEXT_PUBLIC_OPENAI_API_KEY;\n",
    });
    expect(exposed(dir)).toHaveLength(1);
  });

  it("does not flag a VITE_ name read off the wrong object (Vite only inlines import.meta.env.VITE_*)", () => {
    const dir = project({
      "src/config.ts": "export const k = process.env.VITE_STRIPE_SECRET_KEY;\n",
    });
    expect(exposed(dir)).toHaveLength(0);
  });

  it("is clean on a Vite project that only exposes legitimately-public values", () => {
    const dir = project({
      "src/config.ts":
        "export const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;\nexport const url = import.meta.env.VITE_API_BASE_URL;\n",
    });
    expect(exposed(dir)).toHaveLength(0);
  });

  it("dedupes repeated reads of the same exposed var", () => {
    const dir = project({
      "src/config.ts":
        "export const a = import.meta.env.VITE_STRIPE_SECRET_KEY;\nexport const b = import.meta.env.VITE_STRIPE_SECRET_KEY;\n",
    });
    expect(exposed(dir)).toHaveLength(1);
  });
});
