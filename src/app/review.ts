// SPDX-License-Identifier: Apache-2.0
// Turns a scan of a checked-out project into a GitHub Checks result: a conclusion,
// a Markdown summary, and inline annotations. Pure (filesystem + scan only), so it is
// fully testable without GitHub.

import { scanProjectAsync } from "../scan.js";
import { loadConfig } from "../config.js";
import type { ScanResult, Severity } from "../core/types.js";

// GitHub's Checks API accepts at most 50 annotations per request.
const MAX_ANNOTATIONS = 50;

export interface Annotation {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly annotation_level: "failure" | "warning" | "notice";
  readonly title: string;
  readonly message: string;
}

export interface ReviewResult {
  readonly conclusion: "success" | "failure" | "neutral";
  readonly title: string;
  readonly summary: string;
  readonly annotations: Annotation[];
  readonly result: ScanResult;
}

function annotationLevel(severity: Severity): Annotation["annotation_level"] {
  return severity === "error" ? "failure" : severity === "warning" ? "warning" : "notice";
}

function buildSummary(result: ScanResult): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  const lines: string[] = [];
  lines.push("## Tallyguard");
  lines.push("");
  lines.push(
    `**${result.findings.length} finding(s): ${errors} error, ${warnings} warning** ` +
      `(${result.suppressed.length} suppressed)`,
  );
  if (result.findings.length > 0) {
    lines.push("");
    lines.push("| Severity | Rule | Location |");
    lines.push("| --- | --- | --- |");
    for (const f of result.findings.slice(0, MAX_ANNOTATIONS)) {
      lines.push(`| ${f.severity} | \`${f.rule}\` | \`${f.file}:${f.line}\` |`);
    }
    if (result.findings.length > MAX_ANNOTATIONS) {
      lines.push("");
      lines.push(`Showing the first ${MAX_ANNOTATIONS} of ${result.findings.length} findings.`);
    }
  }
  return lines.join("\n");
}

export function reviewToResult(result: ScanResult): ReviewResult {
  const annotations: Annotation[] = result.findings.slice(0, MAX_ANNOTATIONS).map((f) => ({
    path: f.file,
    start_line: f.line,
    end_line: f.line,
    annotation_level: annotationLevel(f.severity),
    title: f.rule,
    message: f.message,
  }));
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const conclusion = errors > 0 ? "failure" : "success";
  const title = errors > 0 ? `${errors} issue(s) to fix` : "No issues found";
  return { conclusion, title, summary: buildSummary(result), annotations, result };
}

/** Scan a checked-out project directory (JS/TS + Python) and produce a Checks-ready review. Async
 *  because the Python analyzer's parser loads its grammar asynchronously (once). */
export async function reviewDirectory(rootDir: string, configPath?: string): Promise<ReviewResult> {
  const config = loadConfig(rootDir, configPath);
  const result = await scanProjectAsync(rootDir, config, {
    unknownGuard: config.rateLimit.unknownGuard,
  });
  return reviewToResult(result);
}
