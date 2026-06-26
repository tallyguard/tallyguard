// SPDX-License-Identifier: Apache-2.0
// Detector 2a: money/missing-idempotency-key. Pure logic over the model (no AST/filesystem),
// so it is trivial to unit test. A Stripe create-call that moves or commits money should pass
// an idempotency key, so a retried request or a redelivered webhook cannot double-charge.

import type { Finding } from "./types.js";
import type { ProjectModel } from "./model.js";

const RULE = "money/missing-idempotency-key" as const;

export function detectMissingIdempotency(model: ProjectModel): Finding[] {
  const findings: Finding[] = [];
  for (const call of model.stripeCalls) {
    if (call.hasIdempotencyKey) continue;
    findings.push({
      rule: RULE,
      file: call.relFile,
      line: call.line,
      severity: "error",
      message:
        `stripe.${call.resource}.create(...) is missing an idempotency key. ` +
        `Pass one in the second argument (\`{ idempotencyKey }\`) so a retry or a redelivered ` +
        `webhook cannot create a duplicate charge.`,
    });
  }
  return findings;
}
