// SPDX-License-Identifier: Apache-2.0
// Human-readable terminal reporter. Follows clig.dev: color is optional and never the
// sole signal; honors a `color: false` caller (NO_COLOR / non-TTY / --no-color).

import type { ScanResult, Severity } from "../core/types.js";

const ANSI = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  red: "[31m",
  yellow: "[33m",
  cyan: "[36m",
};

export interface TerminalOptions {
  readonly color: boolean;
  readonly showSuppressed?: boolean;
}

function severityLabel(s: Severity): string {
  return s === "error" ? "error" : s === "warning" ? "warning" : "info";
}

export function formatTerminal(result: ScanResult, options: TerminalOptions): string {
  const c = (code: string, text: string) => (options.color ? code + text + ANSI.reset : text);
  const sevColor = (s: Severity) =>
    s === "error" ? ANSI.red : s === "warning" ? ANSI.yellow : ANSI.cyan;
  const lines: string[] = [];

  if (result.findings.length === 0) {
    lines.push(c(ANSI.dim, "No findings."));
  }
  for (const f of result.findings) {
    const loc = c(ANSI.cyan, `${f.file}:${f.line}`);
    const sev = c(sevColor(f.severity) + ANSI.bold, severityLabel(f.severity));
    lines.push(`${sev} ${loc}  ${c(ANSI.dim, f.rule)}`);
    lines.push(`  ${f.message}`);
  }

  if (options.showSuppressed && result.suppressed.length > 0) {
    lines.push("");
    lines.push(c(ANSI.dim, "Suppressed:"));
    for (const f of result.suppressed) {
      lines.push(c(ANSI.dim, `  ${f.file}:${f.line} ${f.rule} (${f.suppression.reason})`));
    }
  }

  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  lines.push("");
  lines.push(
    c(
      ANSI.bold,
      `${result.findings.length} finding(s): ${errors} error, ${warnings} warning, ${result.suppressed.length} suppressed`,
    ),
  );
  return lines.join("\n") + "\n";
}
