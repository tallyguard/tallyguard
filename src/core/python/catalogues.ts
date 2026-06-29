// SPDX-License-Identifier: Apache-2.0
// Python sink + limiter catalogues for FastAPI Detector 1. Versioned data (mirrors the JS catalogue
// governance, D037). A route handler "reaches a sink" when it calls a catalogued sensitive operation:
// a call whose receiver root is either (a) a variable bound to a sink CONSTRUCTOR, or (b) an imported
// sink MODULE. Limiters are recognized by a decorator / dependency pattern. Precision-first: only
// clearly-sensitive sinks count; an unrecognized decorator never adds a finding.
//
// Change log (newest first):
//   v2 (2026-06-27): + PY_GLOBAL_LIMITER_RE - recognize a PROJECT-WIDE rate limiter (a rate-limit-named
//     ASGI middleware via `add_middleware`, slowapi's `SlowAPIMiddleware`, or a `Limiter(default_limits=
//     [...])`) and presume coverage for all routes. Fixes a false-positive class found pre-launch on a
//     real app (Serelo) that rate-limits every route via a global middleware (D061). Suppress-only.
//   v1 (2026-06-27): seed for FastAPI Detector 1 (rate limit). Auth (passlib/bcrypt/argon2), LLM
//     (openai/anthropic/cohere/mistral/groq/litellm/replicate), email/SMS (smtplib/sendgrid/twilio);
//     slowapi (`@limiter.limit`), fastapi-limiter (`Depends(RateLimiter(...))`), custom rate-limit
//     names. Validated against real FastAPI repos surfaced by the D059 frequency scan.

import type { SinkCategory } from "../types.js";

export const PY_CATALOGUE_VERSION = 2;

/** Constructors that create a sensitive-sink client/instance (`pwd = CryptContext(...)`,
 *  `client = OpenAI()`). The bound variable becomes a sink of the given category. */
export const PY_SINK_CONSTRUCTORS: Readonly<Record<string, SinkCategory>> = {
  CryptContext: "auth", // passlib
  PasswordHasher: "auth", // argon2
  OpenAI: "ai",
  AsyncOpenAI: "ai",
  AzureOpenAI: "ai",
  Anthropic: "ai",
  AsyncAnthropic: "ai",
  Cohere: "ai",
  ClientV2: "ai", // cohere v2
  Mistral: "ai",
  Groq: "ai",
  AsyncGroq: "ai",
};

/** Modules whose calls are sinks (`bcrypt.checkpw(...)`, `openai.ChatCompletion.create(...)`),
 *  keyed by the imported root/alias name. */
export const PY_SINK_MODULES: Readonly<Record<string, SinkCategory>> = {
  bcrypt: "auth",
  openai: "ai",
  anthropic: "ai",
  cohere: "ai",
  litellm: "ai",
  replicate: "ai",
  groq: "ai",
  smtplib: "email",
  sendgrid: "email",
  twilio: "sms",
};

/** A route is rate-limited when one of its decorators matches this: slowapi `@limiter.limit(...)`
 *  (receiver names a limiter), or a custom rate-limit-named decorator. Suppress-only, so it can
 *  never create a false positive (precision over recall, mirrors the JS custom-limiter rule). */
export const PY_LIMITER_DECORATOR_RE =
  /@\s*\w*limiter\w*\s*\.\s*limit\s*\(|@\s*(rate[_-]?limit|throttle|slow[_-]?down|limiter)\b/i;

/** fastapi-limiter applies a limiter as a route dependency: `Depends(RateLimiter(times=...))`. */
export const PY_LIMITER_DEPENDS_RE = /Depends\s*\(\s*RateLimiter\s*\(/;

/** A PROJECT-WIDE (global) rate limiter applied to every route: a rate-limit-named ASGI middleware
 *  (`app.add_middleware(GlobalRateLimitMiddleware, ...)`), slowapi's own `SlowAPIMiddleware`, or a
 *  slowapi `Limiter` with a non-empty `default_limits`. When any is present, every route is rate
 *  limited, so per-route detection must presume coverage and emit nothing - exactly the precision-safe
 *  behavior the JS analyzer has for a no-path `app.use(limiter)` (D034). Matched on file source text;
 *  suppress-only, so it can never create a false positive. */
export const PY_GLOBAL_LIMITER_RE = new RegExp(
  [
    "add_middleware\\s*\\(\\s*[\\w.]*(?:rate[_-]?limit|throttle|slow_?down|slowapi)[\\w.]*",
    "SlowAPIMiddleware",
    "default_limits\\s*=\\s*\\[\\s*[\"'\\w]",
  ].join("|"),
  "i",
);

/** HTTP methods that mark a decorator as a route registration (`@router.post(...)`). */
export const PY_HTTP_METHODS: ReadonlySet<string> = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
]);
