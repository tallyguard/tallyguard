// SPDX-License-Identifier: Apache-2.0
// Detector 1: rate-limit/unprotected-sensitive-endpoint. Pure logic over the model;
// no AST or filesystem here, so it is trivial to unit test.

import type { Finding, AnalyzerOptions } from "./types.js";
import type { ProjectModel, MiddlewareModel } from "./model.js";

const RULE = "rate-limit/unprotected-sensitive-endpoint" as const;

/**
 * Convert a Next.js `config.matcher` entry to an anchored RegExp. Handles the
 * path-to-regexp param tokens (`:name`, `:name*`, `:name+`, `:name?`) and passes raw-regex
 * matchers (the common negative-lookahead form, alternation groups) through as-is. Returns
 * undefined for an unparseable matcher (the caller treats that conservatively).
 */
function matcherToRegExp(matcher: string): RegExp | undefined {
  try {
    const pattern = matcher
      .replace(/\/:[A-Za-z0-9_]+\*/g, "(?:/.*)?") // /:name*  -> zero or more segments (incl. base)
      .replace(/\/:[A-Za-z0-9_]+\+/g, "/.+") // /:name+  -> one or more segments
      .replace(/\/:[A-Za-z0-9_]+\?/g, "(?:/[^/]+)?") // /:name?  -> optional segment
      .replace(/\/:[A-Za-z0-9_]+/g, "/[^/]+"); // /:name   -> one segment
    return new RegExp("^" + pattern + "$");
  } catch {
    return undefined;
  }
}

/** Whether a Next.js middleware matcher covers a route path. */
function matcherCovers(matcher: string, routePath: string): boolean {
  const re = matcherToRegExp(matcher);
  // Unparseable matcher: do not assume coverage (avoid a silent false negative on a
  // sensitive route). Parseable matchers (incl. negative-lookahead and group forms) are
  // evaluated exactly, which fixes the prior prefix-only false positives.
  return re ? re.test(routePath) : false;
}

function middlewareCovers(mw: MiddlewareModel | undefined, routePath: string): boolean {
  if (!mw || !mw.hasLimiter) return false;
  if (mw.matchers.length === 0) return true; // no matcher => runs on every route
  return mw.matchers.some((m) => matcherCovers(m, routePath));
}

export function detectRateLimit(model: ProjectModel, options: AnalyzerOptions = {}): Finding[] {
  const unknownGuard = options.unknownGuard ?? "flag";
  const findings: Finding[] = [];

  for (const route of model.routes) {
    if (route.sinks.length === 0) continue; // not a sensitive endpoint -> never flag
    const guarded = route.reachableLimiter || middlewareCovers(model.middleware, route.routePath);
    if (guarded) continue;
    // A guard we do not recognize: flag (default) or suppress, per D024.
    if (route.unknownWrapper && unknownGuard === "suppress") continue;

    const sink = route.sinks[0];
    if (!sink) continue;
    const message = route.unknownWrapper
      ? `${route.method} ${route.routePath} reaches a sensitive sink (${sink}) and is wrapped in \`${route.unknownWrapper}\`, which is not a recognized rate limiter. Verify it limits requests, add it to the guard catalogue, or suppress with a reason.`
      : route.kind === "action"
        ? `Server action \`${route.routePath}\` reaches a sensitive sink (${sink}) with no rate limiter reachable in this server action.`
        : route.kind === "credentials"
          ? `The NextAuth Credentials sign-in (${route.method} ${route.routePath}) reaches a sensitive sink (${sink}) with no rate limiter reachable, so logins can be brute-forced (CWE-307). Add a limiter in the authorize callback or on the auth route.`
          : `${route.method} ${route.routePath} reaches a sensitive sink (${sink}) with no rate limiter reachable on this route.`;

    findings.push({
      rule: RULE,
      file: route.relFile,
      line: route.line,
      severity: "error",
      message,
      sink,
    });
  }

  return findings;
}
