// SPDX-License-Identifier: Apache-2.0
// Detector 3: secrets/client-exposed-secret. Pure logic over the model (no AST/filesystem). A
// Next.js `NEXT_PUBLIC_` env var whose name is unambiguously a secret is inlined into the client
// bundle at build time, so it ships to every visitor's browser (CWE-200). This is the
// differentiated *exposure* check - the secret REACHES the client - not commodity secret scanning
// (a credential literal in a file), which dedicated scanners already cover.

import type { Finding } from "./types.js";
import type { ProjectModel } from "./model.js";

const RULE = "secrets/client-exposed-secret" as const;

export function detectClientExposedSecrets(model: ProjectModel): Finding[] {
  return model.exposedSecrets.map((s) => ({
    rule: RULE,
    file: s.relFile,
    line: s.line,
    severity: "error" as const,
    message:
      `\`${s.varName}\` looks like a secret but is a NEXT_PUBLIC_ variable. Next.js inlines every ` +
      `NEXT_PUBLIC_ value into the client bundle at build time, so this key ships to every visitor's ` +
      `browser. Make it server-only (drop the NEXT_PUBLIC_ prefix) and read it only on the server.`,
  }));
}

const CLIENT_API_RULE = "secrets/client-side-api-call" as const;

// A paid/secret API (an LLM host) called from client-side code: the key must be in the browser
// (exposed) and the call has no server-side rate limit (denial-of-wallet). Found dogfooding a real
// bad app whose browser code called api.anthropic.com directly (D054).
export function detectClientSideApiCalls(model: ProjectModel): Finding[] {
  return model.clientSideApiCalls.map((c) => ({
    rule: CLIENT_API_RULE,
    file: c.relFile,
    line: c.line,
    severity: "error" as const,
    sink: "ai" as const,
    message:
      `A paid LLM API (\`${c.host}\`) is called from client-side code, so its API key must be in the ` +
      `browser bundle - exposed to every visitor - and the call has no server-side rate limit ` +
      `(denial-of-wallet). Move the call to a server route/handler and keep the key server-only.`,
  }));
}
