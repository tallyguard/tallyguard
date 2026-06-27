// SPDX-License-Identifier: Apache-2.0
// Catalogues are data, not code (project plan Appendices A-D, D007-style governance).
// This is a first-class, versioned artifact: a change here maps to a benchmark re-run
// (DESIGN-STANDARD Section 3). The data and its change log live together, below.
//
// Change log (newest first):
//   v5 (2026-06-27): + Detector 3 (secrets/client-exposed-secret) catalogue: secret-name tokens
//     (SECRET/SERVICE_ROLE/PRIVATE_KEY/PASSWORD), the server-only providers whose key must never be
//     client-side, and the legit-public allow-list (publishable/anon/site keys). Flags a
//     NEXT_PUBLIC_ env var whose name is unambiguously a secret (Next inlines it into client JS).
//   v4 (2026-06-25): + Detector 2a (money/missing-idempotency-key) catalogue: the payment
//     package (stripe) and the Stripe create-call resources whose calls should carry an
//     idempotency key (paymentIntents/charges/refunds/transfers/subscriptions/checkout.sessions).
//     Validated against real Stripe repos (~78% omitted an idempotency key).
//   v3 (2026-06-24): + AI_API_HOSTS, so a raw `fetch`/HTTP call to a known LLM inference host
//     (no SDK) is detected as an AI sink. Found scanning real apps that call LLM APIs directly
//     by URL. Only literal/known hosts match; a dynamic/env-var base URL stays unflagged
//     (precision-safe: it correctly leaves pure proxy routes to a non-LLM backend clean).
//     Also + AI_SDK_COST_FUNCTIONS: the Vercel AI SDK (`ai`) exports cost calls AND non-cost
//     utilities (createUIMessageStream, convertToModelMessages, tool, ...), so only the cost
//     functions count as a sink. Fixes a false positive (a stream-resume route flagged as AI)
//     found scanning a real repo.
//   v2 (2026-06-24): broaden coverage from real-world usage. AI: + @mistralai/mistralai,
//     groq-sdk, @huggingface/inference, @aws-sdk/client-bedrock-runtime, and Vercel AI SDK /
//     LangChain provider packages (mistral, groq, cohere, azure, bedrock, xai, vertex,
//     perplexity). Email: + @aws-sdk/client-ses, mailgun.js. SMS: + @vonage/server-sdk,
//     plivo, messagebird. Limiters: + `limiter` (token bucket) with removeTokens/tryRemoveTokens.
//     Local inference (ollama) is deliberately excluded: it is not a denial-of-wallet cost sink.
//   v1 (2026-06-24): seed for Detector 1 on the Next.js App Router benchmark (raw SDKs, the
//     Vercel AI SDK, LangChain; bcrypt/argon2; nodemailer/sendgrid/resend/postmark/mailgun;
//     twilio). Limiters: @upstash/ratelimit, rate-limiter-flexible, express-rate-limit,
//     express-slow-down, @fastify/rate-limit, @nestjs/throttler.

import type { SinkCategory } from "./types.js";

/** Bumped whenever the catalogue data below changes; see the change log at the top of file. */
export const CATALOGUE_VERSION = 5;

/** Server-side payment SDK packages whose charge/credit calls should be idempotent (Detector 2a). */
export const PAYMENT_PACKAGES: ReadonlySet<string> = new Set(["stripe"]);

/**
 * Stripe (Node SDK) resource paths whose `.create(...)` moves or commits money and so should
 * carry an idempotency key, to be safe under retries and webhook redelivery (project plan
 * Appendix C). Matched as the suffix of the call's receiver chain, so `stripe.paymentIntents`,
 * `this.stripe.paymentIntents`, and `getStripe().paymentIntents` all match `paymentIntents`.
 */
export const STRIPE_IDEMPOTENT_RESOURCES: readonly string[] = [
  "paymentIntents",
  "charges",
  "refunds",
  "transfers",
  "checkout.sessions",
];

/**
 * Hostnames of well-known LLM inference APIs. A call (e.g. `fetch`, axios) whose URL argument
 * is a literal containing one of these is an AI/LLM cost sink even with no SDK import, which
 * is a common pattern in AI-built apps. Substring match against the literal/template text;
 * a fully dynamic URL (e.g. only an env var) does not match, which is intentional (precision).
 */
export const AI_API_HOSTS: readonly string[] = [
  "api.openai.com",
  "api.anthropic.com",
  "api-inference.huggingface.co",
  "router.huggingface.co",
  "openrouter.ai",
  "api.groq.com",
  "api.mistral.ai",
  "api.cohere.ai",
  "api.cohere.com",
  "generativelanguage.googleapis.com",
  "api.together.xyz",
  "api.together.ai",
  "api.perplexity.ai",
  "api.replicate.com",
  "api.deepseek.com",
  "api.x.ai",
  "api.fireworks.ai",
];

/**
 * Packages whose imported values represent a sensitive/expensive sink. A call whose
 * callee resolves (by binding or by `new`-instance) to one of these is treated as
 * reaching that sink category.
 */
export const SINK_PACKAGES: Readonly<Record<string, SinkCategory>> = {
  // AI / LLM cost (denial of wallet) - the dominant sink in real AI-built apps (Phase 0).
  // Raw provider SDKs:
  openai: "ai",
  "@anthropic-ai/sdk": "ai",
  "@google/generative-ai": "ai",
  "@google/genai": "ai",
  "cohere-ai": "ai",
  replicate: "ai",
  "@mistralai/mistralai": "ai",
  "groq-sdk": "ai",
  "@huggingface/inference": "ai",
  "@aws-sdk/client-bedrock-runtime": "ai",
  // Vercel AI SDK and providers (the dominant pattern in real Next.js apps; `streamText`,
  // `generateText`, etc. are the cost calls). Found by scanning real corpus repos.
  ai: "ai",
  "@ai-sdk/openai": "ai",
  "@ai-sdk/anthropic": "ai",
  "@ai-sdk/google": "ai",
  "@ai-sdk/google-vertex": "ai",
  "@ai-sdk/mistral": "ai",
  "@ai-sdk/groq": "ai",
  "@ai-sdk/cohere": "ai",
  "@ai-sdk/azure": "ai",
  "@ai-sdk/amazon-bedrock": "ai",
  "@ai-sdk/xai": "ai",
  "@ai-sdk/perplexity": "ai",
  "@openrouter/ai-sdk-provider": "ai",
  // LangChain (the cost is constructing/invoking a Chat model, e.g. `new ChatOpenAI()`).
  // Found by scanning a real corpus repo (dandi).
  langchain: "ai",
  "@langchain/openai": "ai",
  "@langchain/anthropic": "ai",
  "@langchain/google-genai": "ai",
  "@langchain/groq": "ai",
  "@langchain/mistralai": "ai",
  "@langchain/cohere": "ai",
  "@langchain/community": "ai",
  // Authentication.
  bcrypt: "auth",
  bcryptjs: "auth",
  argon2: "auth",
  // Outbound email.
  nodemailer: "email",
  "@sendgrid/mail": "email",
  resend: "email",
  postmark: "email",
  mailgun: "email",
  "mailgun.js": "email",
  "@aws-sdk/client-ses": "email",
  // SMS / voice.
  twilio: "sms",
  "@vonage/server-sdk": "sms",
  plivo: "sms",
  messagebird: "sms",
};

/**
 * Packages whose imported class, when instantiated, is a recognized rate-limit guard.
 * A call of one of GUARD_METHODS on such an instance counts as the limiter being wired.
 */
export const LIMITER_PACKAGES: ReadonlySet<string> = new Set([
  "@upstash/ratelimit",
  "rate-limiter-flexible",
  "express-rate-limit",
  "express-slow-down",
  "@fastify/rate-limit",
  "@nestjs/throttler",
  "limiter", // token-bucket RateLimiter
]);

/** Methods that, called on a recognized limiter instance, indicate an enforced limit. */
export const GUARD_METHODS: ReadonlySet<string> = new Set([
  "limit", // @upstash/ratelimit
  "consume", // rate-limiter-flexible
  "check",
  "removeTokens", // limiter (token bucket)
  "tryRemoveTokens", // limiter (token bucket)
]);

/**
 * Packages whose imported function returns Express middleware that rate-limits, e.g.
 * `rateLimit({...})` from express-rate-limit or `slowDown({...})` from express-slow-down.
 * Used as a route-level arg or via `app.use(...)`, not as a `new X()` instance.
 */
export const EXPRESS_LIMITER_PACKAGES: ReadonlySet<string> = new Set([
  "express-rate-limit",
  "express-slow-down",
]);

/**
 * The Vercel AI SDK (`ai`) cost-incurring calls. The package also exports many non-cost
 * utilities (createUIMessageStream, convertToModelMessages, tool, jsonSchema, smoothStream,
 * streamToResponse, ...), so a call to an `ai` import is a sink only if its name is one of
 * these. Other SDKs (openai, @ai-sdk/*, langchain) are used via an instance/provider and do
 * not need this narrowing.
 */
export const AI_SDK_COST_FUNCTIONS: ReadonlySet<string> = new Set([
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
  "embed",
  "embedMany",
  "generateImage",
  "experimental_generateImage",
  "transcribe",
  "experimental_transcribe",
  "generateSpeech",
  "experimental_generateSpeech",
]);

export function sinkCategoryForModule(moduleSpecifier: string): SinkCategory | undefined {
  return SINK_PACKAGES[moduleSpecifier];
}

// --- secrets/client-exposed-secret (Detector 3) ----------------------------------------------
// A Next.js `NEXT_PUBLIC_` env var is inlined into the client bundle at build time, so it is
// readable by every visitor. Naming a SECRET with that prefix exposes it. Precision-first: only
// a name that is UNAMBIGUOUSLY a secret flags. We do NOT flag a bare `API_KEY` (maps, analytics,
// and search services legitimately ship a public key), and we allow the known publishable/anon/
// site keys that are meant to be public. This is the differentiated *exposure* check (the secret
// reaches the browser), not commodity secret scanning (a credential literal in a file).

/** Tokens that make a NEXT_PUBLIC_ name unambiguously a secret. */
const SECRET_NAME_TOKENS: readonly RegExp[] = [
  /SECRET/,
  /SERVICE_ROLE/,
  /PRIVATE_KEY/,
  /PASSWORD|PASSWD/,
];

/** Server-only providers (the same cost services we catalogue as sinks) whose key/token must never
 *  be client-side. A NEXT_PUBLIC name mentioning one of these with a key/token suffix is exposed. */
const SERVER_ONLY_PROVIDERS: readonly string[] = [
  "OPENAI",
  "ANTHROPIC",
  "GROQ",
  "MISTRAL",
  "COHERE",
  "REPLICATE",
  "HUGGINGFACE",
  "SENDGRID",
  "RESEND",
  "MAILGUN",
  "POSTMARK",
  "TWILIO",
  "VONAGE",
  "PLIVO",
];

/** NEXT_PUBLIC names that are LEGITIMATELY public though they look key-ish - never flag. */
const CLIENT_PUBLIC_ALLOW: readonly string[] = [
  "PUBLISHABLE",
  "_ANON",
  "ANON_KEY",
  "SITE_KEY",
  "PUBLIC_KEY",
  "VAPID",
  "FIREBASE",
  "MAPBOX",
  "GOOGLE_MAPS",
  "MAPS_API",
  "RECAPTCHA",
  "TURNSTILE",
  "HCAPTCHA",
  "POSTHOG",
  "SENTRY",
  "_GA_",
  "GTM_",
  "ALGOLIA_SEARCH",
  "ALGOLIA_APP",
  "CLERK_PUBLISHABLE",
];

/**
 * True if `name` (a full `NEXT_PUBLIC_*` env var name) is unambiguously a secret that must not be
 * bundled into the client. Precision-first: legit-public names are excluded first, then only the
 * clearly-secret tokens (or a server-only provider + a key/token suffix) flag.
 */
export function isClientExposedSecretName(name: string): boolean {
  const n = name.toUpperCase();
  if (!n.startsWith("NEXT_PUBLIC_")) return false;
  if (CLIENT_PUBLIC_ALLOW.some((a) => n.includes(a))) return false;
  if (SECRET_NAME_TOKENS.some((re) => re.test(n))) return true;
  return SERVER_ONLY_PROVIDERS.some((p) => n.includes(p)) && /(API_?KEY|_KEY|TOKEN)/.test(n);
}
