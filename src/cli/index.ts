#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Tallyguard CLI. `tallyguard scan [path]` with terminal/JSON/SARIF output and the
// D016 exit-code contract: 0 = clean, 2 = findings, 1 = tool error.
// runCli is pure (returns strings + exit code) so it is unit-testable; the bin wrapper
// at the bottom does the actual I/O.

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { existsSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { scanProject } from "../scan.js";
import { formatJson } from "../report/json.js";
import { formatSarif } from "../report/sarif.js";
import { formatTerminal } from "../report/terminal.js";
import {
  checkForUpdate,
  defaultCacheFile,
  fetchLatestVersion,
  updateCheckSuppressedByEnv,
} from "./update-check.js";
import pkg from "../../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

export interface CliContext {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly stdoutTTY: boolean;
}

export interface CliOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Whether the bin should run the (network) update check after printing output. Only the
   *  interactive terminal path sets this true; machine/CI/non-TTY/disabled paths leave it false. */
  readonly allowUpdateCheck?: boolean;
}

const USAGE = `tallyguard - pre-deploy safety checker

Usage:
  tallyguard scan [path]        Scan a project (default path: current directory)

Options:
  --json                        Output JSON
  --sarif                       Output SARIF 2.1.0
  --format <terminal|json|sarif>
  --config <file>               Path to tallyguard.config.json
  --max-depth <n>               Call-graph depth to follow into helpers (default 2)
  --show-suppressed             List suppressed findings (terminal)
  --no-color                    Disable ANSI color
  --no-update-check             Skip the once-a-day check for a newer version
  -h, --help                    Show help
  --version                     Show version

Exit codes: 0 clean, 2 findings, 1 tool error.
`;

type Format = "terminal" | "json" | "sarif";

export function runCli(argv: string[], ctx: CliContext): CliOutcome {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        sarif: { type: "boolean" },
        format: { type: "string" },
        config: { type: "string" },
        "max-depth": { type: "string" },
        "show-suppressed": { type: "boolean" },
        "no-color": { type: "boolean" },
        "no-update-check": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  } catch (e) {
    return { stdout: "", stderr: `${(e as Error).message}\n\n${USAGE}`, exitCode: 1 };
  }

  const { values, positionals } = parsed;
  if (values.version) return { stdout: `${VERSION}\n`, stderr: "", exitCode: 0 };
  if (values.help || positionals.length === 0) return { stdout: USAGE, stderr: "", exitCode: 0 };

  const command = positionals[0];
  if (command !== "scan") {
    return { stdout: "", stderr: `Unknown command: ${command}\n\n${USAGE}`, exitCode: 1 };
  }

  const target = resolve(ctx.cwd, positionals[1] ?? ".");
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return { stdout: "", stderr: `Not a directory: ${target}\n`, exitCode: 1 };
  }

  const format: Format = values.sarif
    ? "sarif"
    : values.json
      ? "json"
      : ((values.format as Format | undefined) ?? "terminal");
  if (!["terminal", "json", "sarif"].includes(format)) {
    return { stdout: "", stderr: `Unknown format: ${format}\n`, exitCode: 1 };
  }

  let maxDepth: number | undefined;
  if (values["max-depth"] !== undefined) {
    maxDepth = Number(values["max-depth"]);
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      return { stdout: "", stderr: `Invalid --max-depth: ${values["max-depth"]}\n`, exitCode: 1 };
    }
  }

  try {
    const config = loadConfig(target, values.config);
    const result = scanProject(target, config, maxDepth !== undefined ? { maxDepth } : undefined);

    let stdout: string;
    if (format === "json") {
      stdout = formatJson(result, VERSION);
    } else if (format === "sarif") {
      stdout = formatSarif(result, VERSION);
    } else {
      const color = ctx.stdoutTTY && !values["no-color"] && !ctx.env["NO_COLOR"];
      stdout = formatTerminal(result, {
        color,
        showSuppressed: values["show-suppressed"] ?? false,
      });
    }

    const hasError = result.findings.some((f) => f.severity === "error");
    // The update check is an interactive-terminal courtesy only: never in machine output
    // (--json/--sarif), CI, a non-TTY pipe, or when disabled by flag/env/config. Computed here
    // (pure) so the gating is unit-testable; the bin does the actual network/cache I/O.
    const allowUpdateCheck =
      format === "terminal" &&
      ctx.stdoutTTY &&
      config.updateCheck &&
      values["no-update-check"] !== true &&
      !updateCheckSuppressedByEnv(ctx.env);
    return { stdout, stderr: "", exitCode: hasError ? 2 : 0, allowUpdateCheck };
  } catch (e) {
    return { stdout: "", stderr: `tallyguard: ${(e as Error).message}\n`, exitCode: 1 };
  }
}

// Bin entry: run only when invoked as the executable, so tests can import runCli
// side-effect-free. Compare realpaths (not raw URLs): npm's `npx` and `npm i -g` run the bin
// through a SYMLINK, so argv[1] is the symlink path while import.meta.url is the resolved real
// file. A raw-URL compare returned false there, making the CLI silently no-op via npx (0.1.0);
// resolving both sides to realpaths fixes it.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

async function runBin(): Promise<void> {
  const outcome = runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdoutTTY: Boolean(process.stdout.isTTY),
  });
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  if (outcome.allowUpdateCheck) {
    try {
      const notice = await checkForUpdate({
        currentVersion: VERSION,
        cacheFile: defaultCacheFile(process.env),
        now: Date.now(),
        fetchLatest: () => fetchLatestVersion(),
      });
      if (notice) process.stderr.write(notice);
    } catch {
      /* the notifier must never break the CLI */
    }
  }
  process.exit(outcome.exitCode);
}

if (isMainModule()) {
  void runBin();
}
