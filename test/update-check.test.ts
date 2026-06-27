// SPDX-License-Identifier: Apache-2.0
// Unit coverage for the optional CLI update notifier. The network is always injected, so these
// tests never touch the registry.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isNewerVersion,
  updateCheckSuppressedByEnv,
  defaultCacheFile,
  checkForUpdate,
} from "../src/cli/update-check.js";

describe("isNewerVersion", () => {
  it("detects a newer release across each version component", () => {
    expect(isNewerVersion("0.4.0", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.4.1", "0.4.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });
  it("is false for the same or an older version, ignoring a prerelease tag", () => {
    expect(isNewerVersion("0.4.0", "0.4.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.4.0")).toBe(false);
    expect(isNewerVersion("0.4.0-beta.1", "0.4.0")).toBe(false); // same 0.4.0 core
    expect(isNewerVersion("0.5.0-rc.1", "0.4.0")).toBe(true); // 0.5.0 core is newer
  });
  it("is false (never throws) on malformed input", () => {
    expect(isNewerVersion("not-a-version", "0.4.0")).toBe(false);
    expect(isNewerVersion("0.4.0", "")).toBe(false);
  });
});

describe("updateCheckSuppressedByEnv", () => {
  it("suppresses in CI and on an explicit opt-out", () => {
    expect(updateCheckSuppressedByEnv({ CI: "true" })).toBe(true);
    expect(updateCheckSuppressedByEnv({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(updateCheckSuppressedByEnv({ NO_UPDATE_NOTIFIER: "1" })).toBe(true);
    expect(updateCheckSuppressedByEnv({ TALLYGUARD_NO_UPDATE_CHECK: "1" })).toBe(true);
  });
  it("allows in a plain interactive environment", () => {
    expect(updateCheckSuppressedByEnv({})).toBe(false);
    expect(updateCheckSuppressedByEnv({ HOME: "/home/x" })).toBe(false);
  });
});

describe("defaultCacheFile", () => {
  it("honours XDG_CACHE_HOME", () => {
    expect(defaultCacheFile({ XDG_CACHE_HOME: "/tmp/xdg" })).toBe(
      join("/tmp/xdg", "tallyguard", "update-check.json"),
    );
  });
});

describe("checkForUpdate", () => {
  const freshCacheFile = () => join(mkdtempSync(join(tmpdir(), "tg-upd-")), "update-check.json");
  const DAY = 24 * 60 * 60 * 1000;

  it("returns a notice and writes the cache when a newer version is fetched", async () => {
    const cacheFile = freshCacheFile();
    const fetchLatest = vi.fn(async () => "0.5.0" as string | null);
    const notice = await checkForUpdate({
      currentVersion: "0.4.0",
      cacheFile,
      now: 1000,
      fetchLatest,
    });
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(notice).toContain("0.4.0 -> 0.5.0");
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toMatchObject({
      latest: "0.5.0",
      lastCheck: 1000,
    });
  });

  it("uses a fresh cache WITHOUT hitting the network", async () => {
    const cacheFile = freshCacheFile();
    writeFileSync(cacheFile, JSON.stringify({ lastCheck: 5000, latest: "0.5.0" }));
    const fetchLatest = vi.fn(async () => "9.9.9" as string | null);
    const notice = await checkForUpdate({
      currentVersion: "0.4.0",
      cacheFile,
      now: 5000 + DAY - 1,
      fetchLatest,
    });
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(notice).toContain("0.4.0 -> 0.5.0");
  });

  it("refetches once the cache is stale", async () => {
    const cacheFile = freshCacheFile();
    writeFileSync(cacheFile, JSON.stringify({ lastCheck: 1000, latest: "0.4.0" }));
    const fetchLatest = vi.fn(async () => "0.6.0" as string | null);
    const notice = await checkForUpdate({
      currentVersion: "0.4.0",
      cacheFile,
      now: 1000 + DAY,
      fetchLatest,
    });
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(notice).toContain("0.4.0 -> 0.6.0");
  });

  it("returns null when already on the latest", async () => {
    const cacheFile = freshCacheFile();
    const fetchLatest = vi.fn(async () => "0.4.0" as string | null);
    expect(
      await checkForUpdate({ currentVersion: "0.4.0", cacheFile, now: 1, fetchLatest }),
    ).toBeNull();
  });

  it("fails safe (null) and still records the attempt when the fetch fails", async () => {
    const cacheFile = freshCacheFile();
    const fetchLatest = vi.fn(async () => null);
    const notice = await checkForUpdate({
      currentVersion: "0.4.0",
      cacheFile,
      now: 7000,
      fetchLatest,
    });
    expect(notice).toBeNull();
    // lastCheck recorded so we do not hit the registry every run after a failure.
    expect(JSON.parse(readFileSync(cacheFile, "utf8")).lastCheck).toBe(7000);
  });
});
