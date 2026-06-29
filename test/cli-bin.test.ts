// SPDX-License-Identifier: Apache-2.0
// Integration guard for the published executable. npm's `npx` and `npm i -g` invoke the bin
// through a SYMLINK (argv[1] = the symlink path, import.meta.url = the resolved real file). A
// main-module check that compared those as raw URLs returned false through the symlink, so the
// CLI ran nothing and printed nothing via npx (the primary entry point). That shipped in 0.1.0
// and is fixed in 0.1.1 by comparing realpaths. We build the bundle and run it through a
// symlink exactly as npm does, so the regression cannot return silently.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const builtBin = join(root, "dist", "cli", "index.js");

beforeAll(() => {
  // Build so the bundle under test reflects current source (npm test may run before build).
  execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 120_000);

function run(scriptPath: string, args: string[]): string {
  try {
    return execFileSync("node", [scriptPath, ...args], { encoding: "utf8" });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout ?? "") + (err.stderr ?? "");
  }
}

describe("published bin invocation", () => {
  it("produces output when run through a symlink (npx / npm i -g)", () => {
    expect(existsSync(builtBin)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "tg-bin-"));
    const link = join(dir, "tallyguard");
    try {
      symlinkSync(builtBin, link);
      expect(run(link, ["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+$/);
      expect(run(link, [])).toContain("tallyguard - pre-deploy safety checker");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("produces output when run directly (node dist/cli/index.js)", () => {
    expect(run(builtBin, ["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("scans a FastAPI project through the built bin (Python analyzer + wasm resolution)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-bin-py-"));
    try {
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
      const out = run(builtBin, ["scan", dir]);
      expect(out).toContain("rate-limit/unprotected-sensitive-endpoint");
      expect(out).toContain("/login");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
