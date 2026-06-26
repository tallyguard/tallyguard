// Validate SARIF output against the official SARIF 2.1.0 schema (audit AU3).
// The vendored schema (test/fixtures) is draft-07; we strip its $schema so the
// Ajv2020 instance compiles it by its keywords (a superset for SARIF's usage).

import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import sarifSchema from "./fixtures/sarif-2.1.0.schema.json" with { type: "json" };
import { buildSarif } from "../src/index.js";
import type { ScanResult } from "../src/index.js";

const { ["$schema"]: _drop, ...schemaBody } = sarifSchema as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: false });
const validate = ajv.compile(schemaBody);

const sample: ScanResult = {
  findings: [
    {
      rule: "rate-limit/unprotected-sensitive-endpoint",
      file: "app/api/chat/route.ts",
      line: 7,
      severity: "error",
      message: "POST /api/chat reaches a sensitive sink (ai) with no rate limiter.",
      sink: "ai",
    },
  ],
  suppressed: [
    {
      rule: "rate-limit/unprotected-sensitive-endpoint",
      file: "app/api/edge/route.ts",
      line: 3,
      severity: "error",
      message: "edge route",
      sink: "ai",
      suppression: { by: "config", reason: "rate limiting handled at the edge" },
    },
  ],
};

describe("SARIF reporter conforms to SARIF 2.1.0", () => {
  it("validates against the official schema", () => {
    const ok = validate(buildSarif(sample, "1.2.3"));
    if (!ok) console.error(JSON.stringify(validate.errors, null, 2));
    expect(ok).toBe(true);
  });
});
