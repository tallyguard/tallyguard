// SPDX-License-Identifier: Apache-2.0
// Load and apply tallyguard.config.json (schema: schema/tallyguard.config.schema.json).
// This wires the config-level controls (rule levels, edge-handled rate limiting,
// unknownGuard). Inline suppression comments are a separate, later feature.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import configSchema from "../schema/tallyguard.config.schema.json" with { type: "json" };
import type {
  RuleId,
  UnknownGuardPolicy,
  Finding,
  ScanResult,
  SuppressedFinding,
  Severity,
} from "./core/types.js";

export type RuleLevel = "error" | "warn" | "off";

export interface TallyguardConfig {
  readonly rules: Partial<Record<RuleId, RuleLevel>>;
  readonly rateLimit: {
    readonly handledAtEdge: boolean;
    readonly unknownGuard: UnknownGuardPolicy;
  };
  readonly suppressions: {
    readonly requireReason: boolean;
    readonly allowBlanket: boolean;
  };
  readonly graph: {
    readonly maxDepth: number;
  };
}

const DEFAULT_CONFIG: TallyguardConfig = {
  rules: {},
  rateLimit: { handledAtEdge: false, unknownGuard: "flag" },
  suppressions: { requireReason: true, allowBlanket: true },
  graph: { maxDepth: 2 },
};

const RULE_DEFAULT_LEVEL: Readonly<Record<RuleId, RuleLevel>> = {
  "rate-limit/unprotected-sensitive-endpoint": "error",
  "money/missing-idempotency-key": "error",
  "money/check-then-act-race": "warn",
  "tallyguard/suppression-without-reason": "warn",
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

// Validate user config against the committed schema so typos and invalid values are
// rejected loudly rather than silently misbehaving (audit AU2).
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateConfigSchema = ajv.compile(configSchema as object);

/** Load config from an explicit path or `tallyguard.config.json` in the target dir. */
export function loadConfig(targetDir: string, explicitPath?: string): TallyguardConfig {
  const path = explicitPath ?? join(targetDir, "tallyguard.config.json");
  if (!existsSync(path)) return DEFAULT_CONFIG;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Invalid config at ${path}: ${(e as Error).message}`, { cause: e });
  }
  if (!validateConfigSchema(parsed)) {
    throw new Error(`Invalid config at ${path}: ${ajv.errorsText(validateConfigSchema.errors)}`);
  }
  const obj = asRecord(parsed);
  const rl = asRecord(obj["rateLimit"]);
  const sup = asRecord(obj["suppressions"]);
  return {
    rules: asRecord(obj["rules"]) as Partial<Record<RuleId, RuleLevel>>,
    rateLimit: {
      handledAtEdge: rl["handledAtEdge"] === true,
      unknownGuard: rl["unknownGuard"] === "suppress" ? "suppress" : "flag",
    },
    suppressions: {
      requireReason: sup["requireReason"] !== false,
      allowBlanket: sup["allowBlanket"] !== false,
    },
    graph: {
      maxDepth:
        typeof asRecord(obj["graph"])["maxDepth"] === "number"
          ? (asRecord(obj["graph"])["maxDepth"] as number)
          : 2,
    },
  };
}

const levelToSeverity = (level: RuleLevel): Severity => (level === "warn" ? "warning" : "error");

/** Apply config to raw findings: drop/downgrade per rule level and edge handling,
 *  surfacing every suppression rather than silently dropping it (D023). */
export function applyConfig(findings: Finding[], config: TallyguardConfig): ScanResult {
  const active: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const f of findings) {
    const level = config.rules[f.rule] ?? RULE_DEFAULT_LEVEL[f.rule];
    if (level === "off") {
      suppressed.push({ ...f, suppression: { by: "config", reason: "rule disabled in config" } });
      continue;
    }
    if (f.rule.startsWith("rate-limit/") && config.rateLimit.handledAtEdge) {
      suppressed.push({
        ...f,
        suppression: { by: "config", reason: "rate limiting handled at the edge" },
      });
      continue;
    }
    active.push({ ...f, severity: levelToSeverity(level) });
  }

  return { findings: active, suppressed };
}
