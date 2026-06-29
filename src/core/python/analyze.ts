// SPDX-License-Identifier: Apache-2.0
// Orchestration for the Python (FastAPI) analyzer: find .py sources, parse, index the whole project
// (needed because handlers delegate cross-file to service/helper layers), model routes, detect.
// Async only because the parser grammar loads asynchronously (once, cached); analysis is then sync.
// Produces the shared Finding[] consumed by the same reporters/CLI as the JS/TS analyzer.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type Tree } from "web-tree-sitter";
import type { Finding } from "../types.js";
import { type PyNode, getPythonParser } from "./parse.js";
import { buildProjectIndex } from "./project.js";
import { modelRoutes } from "./model.js";
import { detectPyRateLimit } from "./detector.js";

const SKIP_DIRS: ReadonlySet<string> = new Set([
  "venv",
  ".venv",
  "env",
  "__pycache__",
  "node_modules",
  ".git",
  "migrations",
  "alembic",
  "site-packages",
  ".tox",
  "build",
  "dist",
]);
const MAX_BYTES = 1_500_000;
const ROUTE_PREFILTER = /@\s*[\w.]+\.(get|post|put|patch|delete)\s*\(/;

function listPyFiles(root: string): string[] {
  const out: string[] = [];
  const walkDir = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walkDir(full);
      } else if (e.name.endsWith(".py")) {
        out.push(full);
      }
    }
  };
  walkDir(root);
  return out;
}

const toPosix = (p: string): string => p.split(sep).join("/");

/** Analyze a project's Python (FastAPI) sources for Detector 1. Returns [] when no file registers a
 *  route (so a non-FastAPI project pays only a directory walk + cheap reads, never a parse). */
export async function analyzePythonProject(rootDir: string): Promise<Finding[]> {
  const files = listPyFiles(rootDir).filter((f) => {
    try {
      return statSync(f).size <= MAX_BYTES;
    } catch {
      return false;
    }
  });
  if (files.length === 0) return [];

  // Read first; bail before parsing if no file registers a route. When the project IS a FastAPI app
  // we must index ALL its .py (not just route files): handlers delegate cross-file to service /
  // helper modules that never import fastapi, and those are the reachability targets.
  const sources: { rel: string; src: string }[] = [];
  let anyRoute = false;
  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    anyRoute ||= ROUTE_PREFILTER.test(src);
    sources.push({ rel: toPosix(relative(rootDir, file)), src });
  }
  if (!anyRoute) return [];

  // Parse every FastAPI-related file (route files AND the service/helper files they reach), index
  // the project, then model routes with cross-file reachability.
  const parser = await getPythonParser();
  const trees: Tree[] = [];
  const parsed: { rel: string; root: PyNode }[] = [];
  for (const { rel, src } of sources) {
    const tree = parser.parse(src);
    if (!tree) continue;
    trees.push(tree);
    parsed.push({ rel, root: tree.rootNode });
  }
  try {
    const index = buildProjectIndex(parsed);
    const findings: Finding[] = [];
    for (const f of index.files) {
      findings.push(...detectPyRateLimit(modelRoutes(f, index), f.rel));
    }
    return findings;
  } finally {
    for (const t of trees) t.delete();
  }
}
