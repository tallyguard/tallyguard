// SPDX-License-Identifier: Apache-2.0
// FastAPI Detector 1: a route that reaches a sensitive sink with no reachable rate limiter. Same
// rule ID and Finding shape as the JS/TS analyzer - the reporters and CLI are language-agnostic.

import type { Finding } from "../types.js";
import type { PyRoute } from "./model.js";

export function detectPyRateLimit(routes: PyRoute[], relFile: string): Finding[] {
  const out: Finding[] = [];
  for (const r of routes) {
    if (!r.sink || r.limited) continue;
    const where = r.path
      ? `${r.method.toUpperCase()} ${r.path}`
      : `${r.method.toUpperCase()} ${r.name}`;
    out.push({
      rule: "rate-limit/unprotected-sensitive-endpoint",
      file: relFile,
      line: r.line,
      severity: "error",
      sink: r.sink,
      message: `${where} reaches a sensitive sink (${r.sink}) with no rate limiter reachable on this route.`,
    });
  }
  return out;
}
