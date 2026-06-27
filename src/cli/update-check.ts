// SPDX-License-Identifier: Apache-2.0
// Optional CLI update notifier. This is a CLI-only courtesy, NOT part of the analyzer core or the
// detection path: it runs after a scan, in the imperative bin shell. It sends NO data about the
// user or their code - it only asks the public npm registry for tallyguard's latest version and
// receives a number back - so the "your code never leaves your machine / no telemetry" promise
// holds. The CLI gates it off in CI, non-TTY, machine-output (--json/--sarif), and when disabled by
// flag/env/config (see runCli). The result is cached ~24h so the registry is hit at most once a day.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";

const REGISTRY_URL = "https://registry.npmjs.org/tallyguard/latest";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // once a day
const DEFAULT_TIMEOUT_MS = 1500;

export interface UpdateCheckCache {
  readonly lastCheck: number;
  readonly latest: string;
}

/** Parse a `major.minor.patch` into a tuple, ignoring any `-prerelease` / `+build`. null if invalid. */
function parseSemver(v: string): readonly [number, number, number] | null {
  const core = (v.trim().replace(/^v/, "").split(/[-+]/)[0] ?? "").split(".");
  const maj = Number(core[0]);
  const min = Number(core[1]);
  const pat = Number(core[2]);
  for (const n of [maj, min, pat]) {
    if (!Number.isInteger(n) || n < 0) return null;
  }
  return [maj, min, pat];
}

/** True if `latest` is a strictly higher release than `current`. Prereleases are ignored. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

/** True when the environment says the notifier should stay silent: any CI, or an explicit opt-out
 *  env var (the npm-ecosystem `NO_UPDATE_NOTIFIER`, or our own `TALLYGUARD_NO_UPDATE_CHECK`). */
export function updateCheckSuppressedByEnv(env: Record<string, string | undefined>): boolean {
  const ci =
    env["CI"] || env["CONTINUOUS_INTEGRATION"] || env["GITHUB_ACTIONS"] || env["BUILD_NUMBER"];
  const optOut = env["NO_UPDATE_NOTIFIER"] || env["TALLYGUARD_NO_UPDATE_CHECK"];
  return Boolean(ci || optOut);
}

/** Where the once-a-day check result is cached. Honours `XDG_CACHE_HOME`, else `~/.cache`, else tmp. */
export function defaultCacheFile(env: Record<string, string | undefined>): string {
  const xdg = env["XDG_CACHE_HOME"];
  const home = homedir();
  const base = xdg && xdg.length > 0 ? xdg : home ? join(home, ".cache") : tmpdir();
  return join(base, "tallyguard", "update-check.json");
}

/** Fetch the latest published version, or null on any failure/timeout. Sends no user data: a plain
 *  GET of the public registry with a neutral User-Agent (no version, no identifiers). Never throws. */
export async function fetchLatestVersion(
  url: string = REGISTRY_URL,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { accept: "application/json", "user-agent": "tallyguard-cli" },
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const version = (body as { version?: unknown } | null)?.version;
      return typeof version === "string" ? version : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function readCache(file: string): UpdateCheckCache | null {
  try {
    const obj = JSON.parse(readFileSync(file, "utf8")) as Partial<UpdateCheckCache>;
    if (typeof obj.lastCheck === "number" && typeof obj.latest === "string") {
      return { lastCheck: obj.lastCheck, latest: obj.latest };
    }
  } catch {
    /* missing or corrupt cache - treat as none */
  }
  return null;
}

function writeCache(file: string, cache: UpdateCheckCache): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache));
  } catch {
    /* the cache is best-effort; never fail the CLI over it */
  }
}

/** The human notice printed to stderr when an upgrade is available. */
export function formatUpdateNotice(current: string, latest: string): string {
  return (
    `\nUpdate available for tallyguard: ${current} -> ${latest}\n` +
    `  Run \`npm i -D tallyguard@latest\` (or \`npm i -g tallyguard@latest\`) to update.\n` +
    `  Disable: --no-update-check, TALLYGUARD_NO_UPDATE_CHECK=1, or "updateCheck": false in config.\n`
  );
}

export interface UpdateCheckDeps {
  readonly currentVersion: string;
  readonly cacheFile: string;
  readonly now: number;
  readonly ttlMs?: number;
  /** Injected so tests need no network; the bin passes `fetchLatestVersion`. */
  readonly fetchLatest: () => Promise<string | null>;
}

/** Resolve the latest version (cache when fresh, else network), refresh the cache, and return an
 *  upgrade notice if one is available - else null. Never throws and never blocks beyond one fetch. */
export async function checkForUpdate(deps: UpdateCheckDeps): Promise<string | null> {
  const ttl = deps.ttlMs ?? DEFAULT_TTL_MS;
  const cache = readCache(deps.cacheFile);
  let latest = cache?.latest ?? null;

  if (!cache || deps.now - cache.lastCheck >= ttl) {
    const fetched = await deps.fetchLatest();
    latest = fetched ?? latest;
    // Record the attempt either way (even on failure) so we don't hit the registry every run.
    writeCache(deps.cacheFile, { lastCheck: deps.now, latest: latest ?? deps.currentVersion });
  }

  return latest && isNewerVersion(latest, deps.currentVersion)
    ? formatUpdateNotice(deps.currentVersion, latest)
    : null;
}
