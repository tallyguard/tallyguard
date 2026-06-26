// SPDX-License-Identifier: Apache-2.0
// Inline suppression comments (docs/specs/SUPPRESSION-AND-FALSE-POSITIVES.md, D020).
// Parses `tallyguard-disable*` / `tallyguard-enable` directives from source and partitions
// findings into active vs inline-suppressed. Suppressions are surfaced, never dropped (D023).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, SuppressedFinding } from "./core/types.js";

export interface InlineOptions {
  /** Require a ` -- reason`; emit tallyguard/suppression-without-reason if missing. Default true. */
  readonly requireReason: boolean;
  /** Allow a directive that omits the rule id (suppresses all rules). Default true. */
  readonly allowBlanket: boolean;
}

type DirectiveKind = "next-line" | "line" | "file" | "block-start" | "block-end";

interface Directive {
  readonly kind: DirectiveKind;
  readonly line: number; // 1-based
  readonly rules: Set<string>; // empty = blanket (all rules)
  readonly reason: string | undefined;
}

interface Block {
  readonly start: number;
  readonly end: number; // Infinity if never closed
  readonly rules: Set<string>;
  readonly reason: string | undefined;
}

const KEYWORD =
  /tallyguard-(disable-next-line|disable-line|disable-file|disable|enable)\b([^\n*]*)/;

const KIND: Record<string, DirectiveKind> = {
  "disable-next-line": "next-line",
  "disable-line": "line",
  "disable-file": "file",
  disable: "block-start",
  enable: "block-end",
};

function parseRest(rest: string): { rules: Set<string>; reason: string | undefined } {
  const [left, ...reasonParts] = rest.split("--");
  const reasonText = reasonParts.join("--").trim();
  const rules = new Set(
    (left ?? "")
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t.includes("/")),
  );
  return { rules, reason: reasonText.length > 0 ? reasonText : undefined };
}

export function parseDirectives(text: string): Directive[] {
  const directives: Directive[] = [];
  const lines = text.split("\n");
  lines.forEach((lineText, i) => {
    const m = KEYWORD.exec(lineText);
    if (!m) return;
    const kind = KIND[m[1] as string];
    if (!kind) return;
    const { rules, reason } = parseRest(m[2] ?? "");
    directives.push({ kind, line: i + 1, rules, reason });
  });
  return directives;
}

function buildBlocks(directives: Directive[]): Block[] {
  const blocks: Block[] = [];
  let open: Array<{ start: number; rules: Set<string>; reason: string | undefined }> = [];
  for (const d of [...directives].sort((a, b) => a.line - b.line)) {
    if (d.kind === "block-start") {
      open.push({ start: d.line, rules: d.rules, reason: d.reason });
    } else if (d.kind === "block-end") {
      open = open.filter((o) => {
        const overlaps =
          d.rules.size === 0 || o.rules.size === 0 || [...d.rules].some((r) => o.rules.has(r));
        if (overlaps) {
          blocks.push({ start: o.start, end: d.line, rules: o.rules, reason: o.reason });
          return false;
        }
        return true;
      });
    }
  }
  for (const o of open)
    blocks.push({ start: o.start, end: Infinity, rules: o.rules, reason: o.reason });
  return blocks;
}

function covers(rules: Set<string>, rule: string, allowBlanket: boolean): boolean {
  return rules.size === 0 ? allowBlanket : rules.has(rule);
}

interface Match {
  readonly reason: string | undefined;
  readonly directiveLine: number;
}

/** The directive (if any) that suppresses a finding at `line` for `rule`. */
function matchFor(
  directives: Directive[],
  blocks: Block[],
  line: number,
  rule: string,
  allowBlanket: boolean,
): Match | undefined {
  for (const d of directives) {
    if (!covers(d.rules, rule, allowBlanket)) continue;
    if (d.kind === "file") return { reason: d.reason, directiveLine: d.line };
    if (d.kind === "next-line" && d.line + 1 === line)
      return { reason: d.reason, directiveLine: d.line };
    if (d.kind === "line" && d.line === line) return { reason: d.reason, directiveLine: d.line };
  }
  for (const b of blocks) {
    if (line >= b.start && line <= b.end && covers(b.rules, rule, allowBlanket)) {
      return { reason: b.reason, directiveLine: b.start };
    }
  }
  return undefined;
}

export interface InlineResult {
  readonly active: Finding[];
  readonly suppressed: SuppressedFinding[];
  /** New findings raised by the pass itself (e.g. suppression-without-reason). */
  readonly extra: Finding[];
}

export function applyInlineSuppressions(
  rootDir: string,
  findings: Finding[],
  options: InlineOptions,
): InlineResult {
  const cache = new Map<string, { directives: Directive[]; blocks: Block[] }>();
  const getParsed = (file: string) => {
    let p = cache.get(file);
    if (!p) {
      let directives: Directive[];
      try {
        directives = parseDirectives(readFileSync(join(rootDir, file), "utf8"));
      } catch {
        directives = [];
      }
      p = { directives, blocks: buildBlocks(directives) };
      cache.set(file, p);
    }
    return p;
  };

  const active: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  const extraKeys = new Set<string>();
  const extra: Finding[] = [];

  for (const f of findings) {
    const { directives, blocks } = getParsed(f.file);
    const match = matchFor(directives, blocks, f.line, f.rule, options.allowBlanket);
    if (!match) {
      active.push(f);
      continue;
    }
    suppressed.push({ ...f, suppression: { by: "inline", reason: match.reason ?? "" } });
    if (options.requireReason && !match.reason) {
      const key = `${f.file}:${match.directiveLine}`;
      if (!extraKeys.has(key)) {
        extraKeys.add(key);
        extra.push({
          rule: "tallyguard/suppression-without-reason",
          file: f.file,
          line: match.directiveLine,
          severity: "warning",
          message: `Suppression has no reason. Add " -- <reason>" so the suppression is auditable.`,
        });
      }
    }
  }

  return { active, suppressed, extra };
}
