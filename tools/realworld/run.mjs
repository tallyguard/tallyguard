// SPDX-License-Identifier: Apache-2.0
// Real-repo validation: clone each corpus repo at its pinned SHA, run the analyzer, and
// assert the findings exactly match the hand-verified expectations. Because the SHA is
// pinned the output is deterministic, so this is a real regression gate: a missed true
// positive or a new (possible false-positive) finding fails it.
//
// Network-dependent (clones from GitHub), so it is a separate harness, not part of the
// offline unit-test gate. Requires a build first. Usage: npm run realworld

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { analyzeProject, analyzePythonProject } from "../../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"));
const key = (f) => `${f.file}::${f.rule}`;

/** Count occurrences of each key (a multiset), so N findings in one file are asserted as N. */
function counts(items) {
  const m = new Map();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}

function fetchAtSha(repo, sha) {
  const dir = mkdtempSync(join(tmpdir(), "tg-rw-"));
  const opts = { stdio: "ignore", timeout: 120_000 };
  execFileSync("git", ["init", "-q", dir], opts);
  execFileSync(
    "git",
    ["-C", dir, "remote", "add", "origin", `https://github.com/${repo}.git`],
    opts,
  );
  execFileSync("git", ["-C", dir, "fetch", "-q", "--depth", "1", "origin", sha], opts);
  execFileSync("git", ["-C", dir, "checkout", "-q", "FETCH_HEAD"], opts);
  return dir;
}

let failures = 0;
for (const entry of corpus.repos) {
  let dir;
  try {
    dir = fetchAtSha(entry.repo, entry.sha);
  } catch (e) {
    console.log(`FAIL  ${entry.repo}: clone/fetch failed (${String(e.message).slice(0, 80)})`);
    failures++;
    continue;
  }
  try {
    const got = counts(
      entry.analyzer === "python" ? await analyzePythonProject(dir) : analyzeProject(dir),
    );
    const want = counts(entry.expect);
    const keys = new Set([...got.keys(), ...want.keys()]);
    const missing = []; // fewer than expected (regression / missed true positive)
    const extra = []; // more than expected (new finding, review for false positive)
    for (const k of keys) {
      const g = got.get(k) ?? 0;
      const w = want.get(k) ?? 0;
      if (g < w) missing.push(`${k} (got ${g}, want ${w})`);
      if (g > w) extra.push(`${k} (got ${g}, want ${w})`);
    }
    if (missing.length === 0 && extra.length === 0) {
      console.log(`PASS  ${entry.repo}  (${entry.expect.length} expected finding(s))`);
    } else {
      failures++;
      console.log(`FAIL  ${entry.repo}`);
      for (const m of missing) console.log(`   MISSING (regression): ${m}`);
      for (const x of extra) console.log(`   NEW (review): ${x}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"}: ${corpus.repos.length} repos, ${failures} failing.`,
);
process.exit(failures === 0 ? 0 : 1);
