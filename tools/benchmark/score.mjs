// SPDX-License-Identifier: Apache-2.0
// Benchmark scorer (roadmap 1.8; project plan Section 9). Runs the analyzer over every
// benchmark variant and reports the headline numbers the project's credibility rests on:
// detection rate and false-positive rate. Exits non-zero on any false negative or false
// positive, so it doubles as a CI regression gate.
//
// Requires a build first (imports dist/). Usage: npm run benchmark

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeProject } from "../../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const benchmarkDir = join(here, "..", "..", "benchmark");
const manifest = JSON.parse(readFileSync(join(benchmarkDir, "manifest.json"), "utf8"));

const key = (f) => `${f.file}::${f.rule}`;

let tp = 0; // expected findings correctly reported
let fn = 0; // expected findings missed
let fp = 0; // unexpected findings (on any variant)
let negatives = 0; // safe/clean variants (should produce nothing)
let cleanNegatives = 0; // safe/clean variants that produced nothing
const failures = [];

for (const c of manifest.cases) {
  for (const v of c.variants) {
    const findings = analyzeProject(join(benchmarkDir, v.root));
    const got = new Set(findings.map(key));
    const want = new Set((v.expect ?? []).map((e) => key({ file: e.file, rule: e.rule })));

    for (const w of want) {
      if (got.has(w)) tp++;
      else {
        fn++;
        failures.push(`MISS  ${c.id} [${v.kind}] expected ${w}`);
      }
    }
    for (const g of got) {
      if (!want.has(g)) {
        fp++;
        failures.push(`FALSE+ ${c.id} [${v.kind}] unexpected ${g}`);
      }
    }
    if (want.size === 0) {
      negatives++;
      if (got.size === 0) cleanNegatives++;
    }
  }
}

const pct = (n, d) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);
const detection = pct(tp, tp + fn);
const fpRate = pct(fp, negatives);

console.log("Tallyguard benchmark score");
console.log("==========================");
console.log(`Detection rate:     ${detection}  (${tp}/${tp + fn} expected findings reported)`);
console.log(`False positives:    ${fp}  (rate ${fpRate} over ${negatives} safe/clean variants)`);
console.log(`Clean negatives:    ${cleanNegatives}/${negatives}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  " + f);
}

const ok = fn === 0 && fp === 0;
console.log(`\n${ok ? "PASS" : "FAIL"}: detection ${detection}, ${fp} false positive(s).`);
process.exit(ok ? 0 : 1);
