// SPDX-License-Identifier: Apache-2.0
// AST -> model layer. Turns a project directory into the facts the rule engine needs:
// the Next.js App Router routes, the sinks each handler reaches (following calls into
// helper functions up to a bounded depth), whether a recognized rate-limit guard is
// reachable, and the middleware (limiter + matcher). All ts-morph usage is contained here.

import { relative, resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { CallExpression, SourceFile } from "ts-morph";
import {
  SINK_PACKAGES,
  LIMITER_PACKAGES,
  GUARD_METHODS,
  EXPRESS_LIMITER_PACKAGES,
  AI_API_HOSTS,
  AI_SDK_COST_FUNCTIONS,
  PAYMENT_PACKAGES,
  STRIPE_IDEMPOTENT_RESOURCES,
  isClientExposedSecretName,
} from "./catalogues.js";
import type { SinkCategory } from "./types.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const EXPRESS_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "head",
  "options",
]);
const ROUTE_FILE = /\/app\/.*\/route\.[tj]sx?$/;
const MIDDLEWARE_FILE = /(^|\/)middleware\.[tj]sx?$/;
const DEFAULT_MAX_DEPTH = 2;
// Skip pathologically large files (minified bundles, vendored blobs) to bound work and
// memory. They are almost never hand-written route/handler code.
const MAX_FILE_BYTES = 1_500_000;

export interface RouteModel {
  readonly relFile: string;
  readonly routePath: string;
  readonly method: string;
  readonly line: number;
  readonly sinks: SinkCategory[];
  /** A recognized limiter is reachable from the handler (in it or a called helper). */
  readonly reachableLimiter: boolean;
  /** Name of a wrapper around the handler that is not a recognized guard, if any. */
  readonly unknownWrapper: string | undefined;
  /** What kind of surface this is: an HTTP route (default), a Next.js server action, or a
   * NextAuth Credentials sign-in (the `authorize` callback). */
  readonly kind?: "route" | "action" | "credentials";
}

export interface MiddlewareModel {
  readonly relFile: string;
  readonly hasLimiter: boolean;
  readonly matchers: string[];
}

/** A Stripe create-call site relevant to idempotency (Detector 2a). */
export interface StripeCreateCall {
  readonly relFile: string;
  readonly line: number;
  /** The matched resource, e.g. "paymentIntents" or "checkout.sessions". */
  readonly resource: string;
  readonly hasIdempotencyKey: boolean;
}

export interface ExposedSecret {
  readonly relFile: string;
  readonly line: number;
  /** The offending NEXT_PUBLIC_ env var name (e.g. NEXT_PUBLIC_STRIPE_SECRET_KEY). */
  readonly varName: string;
}

export interface ClientApiCall {
  readonly relFile: string;
  readonly line: number;
  /** The paid/secret API host called from client-side code, e.g. api.anthropic.com. */
  readonly host: string;
}

export interface ProjectModel {
  readonly routes: RouteModel[];
  readonly middleware: MiddlewareModel | undefined;
  readonly stripeCalls: StripeCreateCall[];
  readonly exposedSecrets: ExposedSecret[];
  readonly clientSideApiCalls: ClientApiCall[];
}

export interface BuildOptions {
  readonly maxDepth?: number;
}

interface Bindings {
  readonly importModule: Map<string, string>;
  readonly sinkInstances: Map<string, SinkCategory>;
  readonly limiterInstances: Set<string>;
  /**
   * Local name -> the module it came from and which export it binds. `imported` is the
   * original export name, or "default" (ESM default import) or "*" (namespace import /
   * whole-module `require`). Used to follow a handler reference into another file's export,
   * including CommonJS, which the TypeScript checker does not resolve reliably.
   */
  readonly moduleBindings: Map<string, { module: string; imported: string }>;
}

interface Facts {
  readonly sinks: Set<SinkCategory>;
  hasLimiter: boolean;
}

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

function calleeRoot(call: CallExpression): {
  root: string | undefined;
  method: string | undefined;
} {
  const callee = call.getExpression();
  const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
  let node: Node = callee;
  while (Node.isPropertyAccessExpression(node)) node = node.getExpression();
  const root = Node.isIdentifier(node) ? node.getText() : undefined;
  return { root, method };
}

/** Module specifier of a `require("mod")` (optionally `require("mod").member`) initializer. */
function requireModuleSpecifier(init: Node): string | undefined {
  const call = Node.isPropertyAccessExpression(init) ? init.getExpression() : init;
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (!Node.isIdentifier(callee) || callee.getText() !== "require") return undefined;
  const arg = call.getArguments()[0];
  return arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : undefined;
}

function buildBindings(sf: SourceFile): Bindings {
  const importModule = new Map<string, string>();
  const moduleBindings = new Map<string, { module: string; imported: string }>();
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    const def = imp.getDefaultImport();
    if (def) {
      importModule.set(def.getText(), mod);
      moduleBindings.set(def.getText(), { module: mod, imported: "default" });
    }
    const ns = imp.getNamespaceImport();
    if (ns) {
      importModule.set(ns.getText(), mod);
      moduleBindings.set(ns.getText(), { module: mod, imported: "*" });
    }
    for (const named of imp.getNamedImports()) {
      const local = (named.getAliasNode() ?? named.getNameNode()).getText();
      importModule.set(local, mod);
      moduleBindings.set(local, { module: mod, imported: named.getNameNode().getText() });
    }
  }

  // CommonJS: const x = require("m"); const { a } = require("m"); const X = require("m").Y
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init) continue;
    const mod = requireModuleSpecifier(init);
    if (!mod) continue;
    // `require("m").Y` binds the single export Y; a bare `require("m")` binds the whole module.
    const memberOfRequire =
      Node.isPropertyAccessExpression(init) && Node.isCallExpression(init.getExpression())
        ? init.getName()
        : undefined;
    const nameNode = decl.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      importModule.set(nameNode.getText(), mod);
      moduleBindings.set(nameNode.getText(), { module: mod, imported: memberOfRequire ?? "*" });
    } else if (Node.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        const n = el.getNameNode();
        if (!Node.isIdentifier(n)) continue;
        importModule.set(n.getText(), mod);
        // `const { a: b } = require("m")` binds local `b` to export `a`.
        const prop = el.getPropertyNameNode()?.getText() ?? n.getText();
        moduleBindings.set(n.getText(), { module: mod, imported: prop });
      }
    }
  }

  const sinkInstances = new Map<string, SinkCategory>();
  const limiterInstances = new Set<string>();
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isNewExpression(init)) continue;
    const ctor = init.getExpression().getText();
    const mod = importModule.get(ctor);
    if (!mod) continue;
    const sink = SINK_PACKAGES[mod];
    if (sink) sinkInstances.set(decl.getName(), sink);
    if (LIMITER_PACKAGES.has(mod)) limiterInstances.add(decl.getName());
  }
  return { importModule, sinkInstances, limiterInstances, moduleBindings };
}

function getBindings(sf: SourceFile, cache: Map<SourceFile, Bindings>): Bindings {
  let b = cache.get(sf);
  if (!b) {
    b = buildBindings(sf);
    cache.set(sf, b);
  }
  return b;
}

function sinksDirectlyIn(scope: Node, bindings: Bindings): SinkCategory[] {
  const found = new Set<SinkCategory>();
  // Calls whose callee resolves to a sink instance or a sink-package import
  // (e.g. `openai.chat.completions.create(...)`, `streamText(...)`, `bcrypt.compare(...)`).
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const { root, method } = calleeRoot(call);
    if (!root) continue;
    const instance = bindings.sinkInstances.get(root);
    if (instance) {
      found.add(instance);
      continue;
    }
    const mod = bindings.importModule.get(root);
    const viaImport = mod ? SINK_PACKAGES[mod] : undefined;
    if (!viaImport) continue;
    // The `ai` package exports cost calls and non-cost utilities; only cost calls are a sink.
    if (mod === "ai" && !AI_SDK_COST_FUNCTIONS.has(method ?? root)) continue;
    found.add(viaImport);
  }
  // Constructing a sink-package class inside the scope (e.g. LangChain `new ChatOpenAI()`):
  // building an LLM client in a request path is itself the cost signal. The `ai` package is
  // excluded: its classes are stream/transform utilities (JsonToSseTransformStream, ...), not
  // cost constructors, so a `new` from `ai` is not a sink (its cost calls are functions).
  for (const expr of scope.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const mod = bindings.importModule.get(expr.getExpression().getText());
    if (!mod || mod === "ai") continue;
    const sink = SINK_PACKAGES[mod];
    if (sink) found.add(sink);
  }
  // A helper that RETURNS a sink-client singleton (`getResend() { return resend }` or
  // `() => resend`, where `resend` is a module-level `new Resend()`). A caller that uses the
  // returned client reaches the sink, so the function is treated as producing it. This closes
  // the lazy-client recall gap and is precision-safe: it only matches an identifier already
  // catalogued as a sink instance, so it can never add a sink for non-sink code.
  const addIfSinkInstance = (e: Node | undefined): void => {
    if (!e || !Node.isIdentifier(e)) return;
    const inst = bindings.sinkInstances.get(e.getText());
    if (!inst) return;
    // Hold the "never match a sink by name alone" invariant: confirm the identifier resolves to the
    // module-level `new X()` instance, not a same-named parameter/local that shadows it.
    let defs: Node[];
    try {
      defs = e.getDefinitionNodes();
    } catch {
      return;
    }
    if (defs.some((d) => Node.isParameterDeclaration(d) || Node.isBindingElement(d))) return;
    found.add(inst);
  };
  for (const ret of scope.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    addIfSinkInstance(ret.getExpression());
  }
  if (Node.isArrowFunction(scope)) {
    const body = scope.getBody();
    if (!Node.isBlock(body)) addIfSinkInstance(body);
  }
  // A raw HTTP call (fetch/axios/etc.) to a known LLM inference host, with no SDK. The URL is
  // a literal or a template whose static text names the host (a dynamic-only URL won't match).
  if (!found.has("ai")) {
    for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getArguments().some((a) => argMentionsAiHost(a))) {
        found.add("ai");
        break;
      }
    }
  }
  return [...found];
}

/** The LLM API host named by a call argument's static text (string/template literal), if any. */
function aiHostInArg(arg: Node): string | undefined {
  let text: string | undefined;
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    text = arg.getLiteralText();
  } else if (Node.isTemplateExpression(arg)) {
    text = arg.getText(); // includes the literal spans; a host in a literal span still matches
  }
  if (text === undefined) return undefined;
  const t = text;
  return AI_API_HOSTS.find((h) => t.includes(h));
}

/** True if a call argument is a string/template literal whose static text names an LLM API host. */
function argMentionsAiHost(arg: Node): boolean {
  return aiHostInArg(arg) !== undefined;
}

/** True if the file opens with a top-level `"use client"` directive (a Next.js client component,
 * bundled into the browser). */
function hasUseClientDirective(sf: SourceFile): boolean {
  const first = sf.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralValue() === "use client";
}

// HTTP-client call shapes, so a non-request call that merely names a host (a log line, a comment,
// an analytics event) is not mistaken for an API call - a false-positive guard (audit C1).
const HTTP_CALL_NAMES: ReadonlySet<string> = new Set(["fetch", "$fetch", "axios", "ky", "got"]);
const HTTP_CLIENT_ROOTS: ReadonlySet<string> = new Set(["axios", "ky", "got", "http", "https"]);

/** True if `call` looks like an HTTP request: `fetch(...)`, `axios.post(...)`, `ky.get(...)`,
 * `http.request(...)`, etc. - not an arbitrary `.get`/`.post`/`console.log`, to stay precise. */
function isHttpClientCall(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return HTTP_CALL_NAMES.has(callee.getText());
  if (Node.isPropertyAccessExpression(callee)) {
    const rootNode = callee.getExpression();
    return Node.isIdentifier(rootNode) && HTTP_CLIENT_ROOTS.has(rootNode.getText());
  }
  return false;
}

/**
 * A call to a paid LLM API host from CLIENT-side code - a root `public/` asset served verbatim to
 * the browser, or a `"use client"` component. Calling a key-protected API from the browser means
 * the key ships to every visitor (exposure) and there is no server-side rate limit
 * (denial-of-wallet). Detector 1 only models server routes, Detector 3 only NEXT_PUBLIC_ vars, so
 * this client-side shape is its own pass (D054). Found dogfooding a real bad app (a browser ->
 * api.anthropic.com call). Precision guards (audit C1/H1): only an HTTP-client call whose URL
 * argument names a known host counts, and `public/` is anchored to the project-root static dir.
 */
function modelClientSideAiCalls(sf: SourceFile, root: string): ClientApiCall[] {
  const relFile = toPosix(relative(root, sf.getFilePath()));
  if (!relFile.startsWith("public/") && !hasUseClientDirective(sf)) return [];
  const out: ClientApiCall[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isHttpClientCall(call)) continue;
    const arg0 = call.getArguments()[0];
    const host = arg0 ? aiHostInArg(arg0) : undefined;
    if (host) out.push({ relFile, line: call.getStartLineNumber(), host });
  }
  return out;
}

// A function name that strongly implies a rate limiter (e.g. rateLimit, checkEmailRateLimit,
// throttle, slowDown). Recognizing a call to such a helper as a limiter only ever SUPPRESSES a
// finding, never adds one, so it cannot create a false positive; it prevents flagging routes and
// server actions that enforce limits through a custom, project-specific limiter function (a very
// common real-world pattern). The trade is a possible missed finding if a function is named like
// a limiter but does not limit, which is the precision-over-recall side we accept (D036).
const RATE_LIMIT_NAME = /rate.?limit|throttle|slow.?down/i;

function limiterDirectlyIn(scope: Node, bindings: Bindings): boolean {
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const { root, method } = calleeRoot(call);
    if (root && method && GUARD_METHODS.has(method) && bindings.limiterInstances.has(root)) {
      return true;
    }
    const callee = call.getExpression();
    const name = Node.isIdentifier(callee)
      ? callee.getText()
      : Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : undefined;
    if (name && RATE_LIMIT_NAME.test(name)) return true;
  }
  return false;
}

/** The function-like scope a definition node represents, if any. */
function functionScopeOf(def: Node): Node | undefined {
  if (
    Node.isFunctionDeclaration(def) ||
    Node.isArrowFunction(def) ||
    Node.isFunctionExpression(def) ||
    Node.isMethodDeclaration(def)
  ) {
    return def;
  }
  // A name bound to a function: `const f = () => {}`, `login: () => {}` (object/exports map).
  if (Node.isVariableDeclaration(def) || Node.isPropertyAssignment(def)) {
    const init = def.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init;
  }
  return undefined;
}

/**
 * Sinks and limiter reachable from `scope`, following direct function calls into their
 * (project-local) definitions up to `depth` more levels. Bounded by `depth` and a visited
 * set so cycles and large graphs terminate.
 */
function collectReachable(
  scope: Node,
  sf: SourceFile,
  depth: number,
  visited: Set<Node>,
  cache: Map<SourceFile, Bindings>,
): Facts {
  // Resource cap: skip oversized files entirely (DoS / memory guard).
  if (sf.getFullText().length > MAX_FILE_BYTES) {
    return { sinks: new Set(), hasLimiter: false };
  }
  const bindings = getBindings(sf, cache);
  const facts: Facts = {
    sinks: new Set(sinksDirectlyIn(scope, bindings)),
    hasLimiter: limiterDirectlyIn(scope, bindings),
  };
  if (depth <= 0) return facts;

  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee)) continue; // direct fn calls only (foo(...))
    let defs: Node[];
    try {
      defs = callee.getDefinitionNodes();
    } catch {
      continue;
    }
    for (const def of defs) {
      const target = functionScopeOf(def);
      if (!target) continue;
      if (target.getSourceFile().getFilePath().includes("/node_modules/")) continue;
      if (visited.has(target)) continue;
      visited.add(target);
      const sub = collectReachable(target, target.getSourceFile(), depth - 1, visited, cache);
      for (const s of sub.sinks) facts.sinks.add(s);
      if (sub.hasLimiter) facts.hasLimiter = true;
    }
  }
  return facts;
}

function routePathFromRel(rel: string): string {
  const parts = rel.split("/");
  const appIdx = parts.indexOf("app");
  if (appIdx === -1) return "/";
  const mid = parts.slice(appIdx + 1, -1).filter((p) => !(p.startsWith("(") && p.endsWith(")")));
  return "/" + mid.join("/");
}

interface HandlerScope {
  readonly scope: Node;
  readonly unknownWrapper: string | undefined;
  /** The wrapper's callee identifier (`withWorkspace` in `export const POST = withWorkspace(fn)`),
   * so its body can be checked for a limiter it enforces. */
  readonly wrapperCallee: Node | undefined;
  readonly line: number;
}

function extractHandler(decl: Node): HandlerScope | undefined {
  if (Node.isFunctionDeclaration(decl)) {
    return {
      scope: decl,
      unknownWrapper: undefined,
      wrapperCallee: undefined,
      line: decl.getStartLineNumber(),
    };
  }
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    const line = decl.getStartLineNumber();
    if (!init) return undefined;
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      return { scope: init, unknownWrapper: undefined, wrapperCallee: undefined, line };
    }
    if (Node.isCallExpression(init)) {
      const calleeNode = init.getExpression();
      const wrapper = calleeRoot(init).root;
      const fnArg = init
        .getArguments()
        .find((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a));
      return {
        scope: fnArg ?? init,
        unknownWrapper: wrapper,
        wrapperCallee: Node.isIdentifier(calleeNode) ? calleeNode : undefined,
        line,
      };
    }
  }
  return undefined;
}

/**
 * A handler wrapped in a HOF (`export const POST = withWorkspace(fn)`) is covered if the wrapper
 * itself enforces a limiter, a common Next.js pattern (an auth/workspace wrapper that also rate
 * limits). We analyze only the inner handler by default, so resolve the wrapper and check its
 * body for a reachable limiter. Suppress-only: it can never add a finding.
 */
function wrapperEnforcesLimiter(
  callee: Node,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
): boolean {
  if (!Node.isIdentifier(callee)) return false;
  let defs: Node[];
  try {
    defs = callee.getDefinitionNodes();
  } catch {
    return false;
  }
  for (const def of defs) {
    const scope = functionScopeOf(def);
    if (!scope) continue;
    if (scope.getSourceFile().getFilePath().includes("/node_modules/")) continue;
    const facts = collectReachable(scope, scope.getSourceFile(), maxDepth, new Set([scope]), cache);
    if (facts.hasLimiter) return true;
  }
  return false;
}

function modelRoutes(
  sf: SourceFile,
  root: string,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
): RouteModel[] {
  const relFile = toPosix(relative(root, sf.getFilePath()));
  const routePath = routePathFromRel(relFile);
  const exported = sf.getExportedDeclarations();
  const routes: RouteModel[] = [];
  for (const method of HTTP_METHODS) {
    const decls = exported.get(method);
    if (!decls) continue;
    for (const decl of decls) {
      const handler = extractHandler(decl);
      if (!handler) continue;
      const facts = collectReachable(handler.scope, sf, maxDepth, new Set([handler.scope]), cache);
      // A HOF wrapper around the handler may itself enforce a limiter (e.g. withWorkspace).
      if (!facts.hasLimiter && handler.wrapperCallee) {
        if (wrapperEnforcesLimiter(handler.wrapperCallee, maxDepth, cache)) facts.hasLimiter = true;
      }
      routes.push({
        relFile,
        routePath,
        method,
        line: handler.line,
        sinks: [...facts.sinks],
        reachableLimiter: facts.hasLimiter,
        unknownWrapper: handler.unknownWrapper,
      });
    }
  }
  return routes;
}

function modelMiddleware(
  sf: SourceFile,
  root: string,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
): MiddlewareModel {
  const matchers: string[] = [];
  const configDecls = sf.getExportedDeclarations().get("config") ?? [];
  for (const decl of configDecls) {
    if (!Node.isVariableDeclaration(decl)) continue;
    const init = decl.getInitializer();
    if (!init || !Node.isObjectLiteralExpression(init)) continue;
    const prop = init.getProperty("matcher");
    if (!prop || !Node.isPropertyAssignment(prop)) continue;
    const value = prop.getInitializer();
    if (!value) continue;
    if (Node.isArrayLiteralExpression(value)) {
      for (const el of value.getElements()) {
        if (Node.isStringLiteral(el)) matchers.push(el.getLiteralValue());
      }
    } else if (Node.isStringLiteral(value)) {
      matchers.push(value.getLiteralValue());
    }
  }
  const facts = collectReachable(sf, sf, maxDepth, new Set([sf as Node]), cache);
  return {
    relFile: toPosix(relative(root, sf.getFilePath())),
    hasLimiter: facts.hasLimiter,
    matchers,
  };
}

// --- Next.js server actions ------------------------------------------------------------
// A file with a top-level "use server" directive exposes its exported async functions as
// server actions: client-callable RPC endpoints (POST under the hood), a sensitive surface
// just like a route handler, and where modern AI-built Next.js apps often put their logic.
// Inline `"use server"` closures (an action's own directive in a non-directive file) are also
// modeled, by modelInlineServerActions below (D050).

/** True if the file's first statement is a top-level `"use server"` directive. */
function hasUseServerDirective(sf: SourceFile): boolean {
  const first = sf.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralValue() === "use server";
}

function modelServerActions(
  sf: SourceFile,
  root: string,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
): RouteModel[] {
  if (!hasUseServerDirective(sf)) return [];
  const relFile = toPosix(relative(root, sf.getFilePath()));
  const routes: RouteModel[] = [];
  const seen = new Set<Node>();

  const add = (name: string, scope: Node, line: number): void => {
    if (seen.has(scope)) return;
    seen.add(scope);
    const facts = collectReachable(scope, sf, maxDepth, new Set([scope]), cache);
    routes.push({
      relFile,
      routePath: name,
      method: "POST",
      line,
      sinks: [...facts.sinks],
      reachableLimiter: facts.hasLimiter,
      unknownWrapper: undefined,
      kind: "action",
    });
  };

  for (const [name, decls] of sf.getExportedDeclarations()) {
    for (const decl of decls) {
      if (decl.getSourceFile() !== sf) continue; // defined here, not a re-export
      if (Node.isFunctionDeclaration(decl) && decl.isAsync()) {
        add(name, decl, decl.getStartLineNumber());
      } else if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer();
        if (
          init &&
          (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) &&
          init.isAsync()
        ) {
          add(name, init, decl.getStartLineNumber());
        }
      }
    }
  }
  return routes;
}

/** A function whose own body opens with `"use server"` is an inline server action (a
 * client-callable POST RPC) even when the file has no top-level directive - the common App
 * Router pattern `async function f(fd) { "use server"; ... }` inside a component. Closes the
 * recall gap left by modelServerActions (D050). */
function bodyHasUseServerDirective(fn: Node): boolean {
  const body =
    Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isArrowFunction(fn)
      ? fn.getBody()
      : undefined;
  if (!body || !Node.isBlock(body)) return false;
  const first = body.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralValue() === "use server";
}

/** A readable label for an inline action (its function name, or the variable/property it is
 * bound to), used as the reported path; the file + line still pinpoint it. */
function inlineActionName(fn: Node): string {
  if (Node.isFunctionDeclaration(fn)) {
    const n = fn.getName();
    if (n) return n;
  }
  const parent = fn.getParent();
  if (parent && Node.isVariableDeclaration(parent)) {
    const nm = parent.getNameNode();
    if (Node.isIdentifier(nm)) return nm.getText();
  }
  if (parent && Node.isPropertyAssignment(parent)) return parent.getName();
  return "(inline server action)";
}

function modelInlineServerActions(
  sf: SourceFile,
  root: string,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
): RouteModel[] {
  // A top-level "use server" file is already fully modeled by modelServerActions.
  if (hasUseServerDirective(sf)) return [];
  const relFile = toPosix(relative(root, sf.getFilePath()));
  const candidates: Node[] = [
    ...sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sf.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.ArrowFunction),
  ];
  const routes: RouteModel[] = [];
  for (const fn of candidates) {
    if (!bodyHasUseServerDirective(fn)) continue;
    const facts = collectReachable(fn, sf, maxDepth, new Set<Node>([fn]), cache);
    routes.push({
      relFile,
      routePath: inlineActionName(fn),
      method: "POST",
      line: fn.getStartLineNumber(),
      sinks: [...facts.sinks],
      reachableLimiter: facts.hasLimiter,
      unknownWrapper: undefined,
      kind: "action",
    });
  }
  return routes;
}

// --- NextAuth / Auth.js credential sign-in ---------------------------------------------
// A Credentials provider's `authorize` callback runs on every credential sign-in (POST
// /api/auth/callback/credentials), so it is the login endpoint. If it reaches a password
// sink (bcrypt/argon2) with no reachable limiter, logins can be brute-forced (CWE-307). We
// locate the `Credentials(...)` / `CredentialsProvider(...)` call by its import module
// (the name varies between NextAuth v4 and Auth.js v5) and analyze its `authorize` function.

const CREDENTIALS_MODULES = new Set([
  "next-auth/providers/credentials",
  "@auth/core/providers/credentials",
]);

function modelNextAuthCredentials(
  sf: SourceFile,
  root: string,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
): RouteModel[] {
  const bindings = getBindings(sf, cache);
  const routes: RouteModel[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeName = rootIdent(call.getExpression());
    const mod = calleeName ? bindings.importModule.get(calleeName) : undefined;
    if (!mod || !CREDENTIALS_MODULES.has(mod)) continue;
    const arg0 = call.getArguments()[0];
    if (!arg0 || !Node.isObjectLiteralExpression(arg0)) continue;
    const authorize = arg0.getProperty("authorize");
    if (!authorize) continue;
    const scope = functionScopeOf(authorize);
    if (!scope) continue;
    const facts = collectReachable(scope, sf, maxDepth, new Set([scope]), cache);
    routes.push({
      relFile: toPosix(relative(root, sf.getFilePath())),
      routePath: "/api/auth/callback/credentials",
      method: "POST",
      line: authorize.getStartLineNumber(),
      sinks: [...facts.sinks],
      reachableLimiter: facts.hasLimiter,
      unknownWrapper: undefined,
      kind: "credentials",
    });
  }
  return routes;
}

// --- Express ---------------------------------------------------------------------------
// Express analysis (D033, D034): app/router instances, route registrations, route-level and
// same-instance global/path `app.use(limiter)`, ESM and CommonJS. Handlers and limiters are
// followed across files: a `controller.method` or imported handler resolves into another
// file's export (including CommonJS `exports.x`, which the TS checker does not resolve), and
// a limiter imported from a local wrapper module is recognized. Routers split into other
// files cannot be tied back to their mount across files, so coverage there is precision-safe:
// if the project applies any app-wide limiter, router routes are presumed covered rather than
// flagged (favoring no false positives over recall). See D034.

/** Leftmost identifier of a (possibly chained) expression, e.g. `app` in `app.route.get`. */
function rootIdent(node: Node): string | undefined {
  let n = node;
  while (Node.isPropertyAccessExpression(n)) n = n.getExpression();
  return Node.isIdentifier(n) ? n.getText() : undefined;
}

/** Does an export of `targetSf` hold a constructed Express limiter (a local limiter wrapper)? */
function exportedValueIsExpressLimiter(
  targetSf: SourceFile,
  exportName: string,
  cache: Map<SourceFile, Bindings>,
): boolean {
  const bindings = getBindings(targetSf, cache);
  let value: Node | undefined =
    exportName === "*" || exportName === "default"
      ? findDefaultExportValue(targetSf)
      : findExportValue(targetSf, exportName);
  // Follow a same-file identifier (`const limiter = rateLimit(...); export default limiter`).
  for (let hops = 0; value && Node.isIdentifier(value) && hops < 5; hops++) {
    value = targetSf.getVariableDeclaration(value.getText())?.getInitializer();
  }
  if (!value || !Node.isCallExpression(value)) return false;
  const root = rootIdent(value.getExpression());
  const mod = root ? bindings.importModule.get(root) : undefined;
  return mod !== undefined && EXPRESS_LIMITER_PACKAGES.has(mod);
}

/** A middleware arg that is a recognized Express limiter (express-rate-limit / express-slow-down). */
function isExpressLimiterArg(
  arg: Node,
  bindings: Bindings,
  limiterVars: Set<string>,
  sf: SourceFile,
  project: Project,
  cache: Map<SourceFile, Bindings>,
): boolean {
  if (Node.isIdentifier(arg)) {
    if (limiterVars.has(arg.getText())) return true;
    // A limiter imported from a local wrapper module (`import limiter from "../utils/limiter"`).
    const mb = bindings.moduleBindings.get(arg.getText());
    if (mb && mb.module.startsWith(".")) {
      const target = resolveRelativeModule(project, sf, mb.module);
      if (target && exportedValueIsExpressLimiter(target, mb.imported, cache)) return true;
    }
    return false;
  }
  if (Node.isCallExpression(arg)) {
    const root = rootIdent(arg.getExpression());
    const mod = root ? bindings.importModule.get(root) : undefined;
    return mod !== undefined && EXPRESS_LIMITER_PACKAGES.has(mod);
  }
  return false;
}

/** Express app/router instance vars and vars holding an Express limiter middleware. */
function expressBindings(
  sf: SourceFile,
  bindings: Bindings,
): { instances: Set<string>; apps: Set<string>; limiterVars: Set<string> } {
  const instances = new Set<string>();
  const apps = new Set<string>();
  const limiterVars = new Set<string>();
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression();
    const root = rootIdent(callee);
    const mod = root ? bindings.importModule.get(root) : undefined;
    if (mod === "express") {
      // express() makes a mountable app (a root); express.Router() or a named Router() makes
      // a router. With a named import (`import { Router } from "express"`) the call is a bare
      // identifier, so the property-access name is undefined; use the imported name too.
      const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
      const importedName = root ? bindings.moduleBindings.get(root)?.imported : undefined;
      const isRouter = method === "Router" || importedName === "Router";
      if (isRouter) {
        instances.add(decl.getName());
      } else if (method === undefined) {
        // A default/namespace `express()` call: a mountable app.
        instances.add(decl.getName());
        apps.add(decl.getName());
      }
    }
    if (mod !== undefined && EXPRESS_LIMITER_PACKAGES.has(mod)) limiterVars.add(decl.getName());
  }
  return { instances, apps, limiterVars };
}

/**
 * Does this file apply a recognized limiter globally on an Express app with no path prefix
 * (`app.use(rateLimit())`)? Such a limiter covers every route on that app and every router
 * mounted on it. Used as a precision-safe, project-wide signal: when a CommonJS/ESM app
 * splits its routers into other files (so we cannot tie a specific router back to its mount),
 * a project-wide app-level limiter means router routes are presumed covered rather than flagged.
 */
function hasGlobalAppLimiter(
  sf: SourceFile,
  project: Project,
  cache: Map<SourceFile, Bindings>,
): boolean {
  const bindings = getBindings(sf, cache);
  const { apps, limiterVars } = expressBindings(sf, bindings);
  if (apps.size === 0) return false;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "use") continue;
    const obj = rootIdent(callee.getExpression());
    if (!obj || !apps.has(obj)) continue;
    const args = call.getArguments();
    if (args[0] && Node.isStringLiteral(args[0])) continue; // path-scoped, not app-wide
    if (args.some((a) => isExpressLimiterArg(a, bindings, limiterVars, sf, project, cache)))
      return true;
  }
  return false;
}

/** Resolve a relative module specifier to a source file already in the project, if present. */
function resolveRelativeModule(
  project: Project,
  fromSf: SourceFile,
  spec: string,
): SourceFile | undefined {
  const base = resolve(dirname(fromSf.getFilePath()), spec);
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  for (const e of exts) {
    const f = project.getSourceFile(base + e);
    if (f) return f;
  }
  for (const e of exts.slice(1)) {
    const f = project.getSourceFile(join(base, "index" + e));
    if (f) return f;
  }
  return undefined;
}

/** The value node bound to a named export of `sf` (ESM or CommonJS), if any. */
function findExportValue(sf: SourceFile, name: string): Node | undefined {
  const decls = sf.getExportedDeclarations().get(name);
  if (decls) {
    for (const d of decls) {
      if (Node.isVariableDeclaration(d)) {
        const init = d.getInitializer();
        if (init) return init;
      } else {
        return d;
      }
    }
  }
  // CommonJS: exports.name = X; module.exports.name = X; module.exports = { name: X }.
  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const lhs = bin.getLeft();
    if (!Node.isPropertyAccessExpression(lhs)) continue;
    const lhsObj = lhs.getExpression().getText();
    const rhs = bin.getRight();
    if (lhs.getName() === name && (lhsObj === "exports" || lhsObj === "module.exports")) {
      return rhs;
    }
    if (lhs.getName() === "exports" && lhsObj === "module" && Node.isObjectLiteralExpression(rhs)) {
      const prop = rhs.getProperty(name);
      if (prop) return prop;
    }
  }
  return undefined;
}

/** The value node bound to the default export of `sf` (`export default X` / `module.exports = X`). */
function findDefaultExportValue(sf: SourceFile): Node | undefined {
  const ea = sf.getExportAssignments().find((a) => !a.isExportEquals());
  if (ea) return ea.getExpression();
  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const lhs = bin.getLeft();
    if (
      Node.isPropertyAccessExpression(lhs) &&
      lhs.getName() === "exports" &&
      lhs.getExpression().getText() === "module"
    ) {
      return bin.getRight();
    }
  }
  return undefined;
}

/** Normalize a value node to the function-like scope it denotes (resolving an identifier). */
function asFunctionScope(node: Node): Node | undefined {
  const direct = functionScopeOf(node);
  if (direct) return direct;
  if (Node.isIdentifier(node)) {
    try {
      for (const d of node.getDefinitionNodes()) {
        const s = functionScopeOf(d);
        if (s) return s;
      }
    } catch {
      /* unresolved */
    }
  }
  return undefined;
}

/**
 * Resolve a route handler reference to its function scope across files, using the file's
 * module bindings. Handles `controller.method` (member access) and bare imported identifiers,
 * for both ESM and CommonJS, where the TypeScript checker does not resolve `require`/`exports`.
 * Returns undefined to let the caller fall back to checker-based resolution.
 */
function resolveCrossFileHandlerScope(
  arg: Node,
  sf: SourceFile,
  bindings: Bindings,
  project: Project,
): Node | undefined {
  if (Node.isPropertyAccessExpression(arg)) {
    const objName = rootIdent(arg.getExpression());
    const mb = objName ? bindings.moduleBindings.get(objName) : undefined;
    if (!mb || !mb.module.startsWith(".")) return undefined;
    const target = resolveRelativeModule(project, sf, mb.module);
    if (!target) return undefined;
    const prop = arg.getName();
    if (mb.imported === "*" || mb.imported === "default") {
      // `const c = require("./c"); c.method` -> export `method` of c.
      const v = findExportValue(target, prop);
      return v ? asFunctionScope(v) : undefined;
    }
    // `import { obj } from "./c"; obj.method` -> property `method` of the exported object.
    const v = findExportValue(target, mb.imported);
    if (v && Node.isObjectLiteralExpression(v)) {
      const p = v.getProperty(prop);
      if (p) return functionScopeOf(p);
    }
    return undefined;
  }
  if (Node.isIdentifier(arg)) {
    const mb = bindings.moduleBindings.get(arg.getText());
    if (!mb || !mb.module.startsWith(".")) return undefined;
    const target = resolveRelativeModule(project, sf, mb.module);
    if (!target) return undefined;
    const v =
      mb.imported === "*" || mb.imported === "default"
        ? findDefaultExportValue(target)
        : findExportValue(target, mb.imported);
    return v ? asFunctionScope(v) : undefined;
  }
  return undefined;
}

/** Sinks/limiter reachable from a route handler arg (inline function or referenced identifier). */
function factsForHandlerArg(
  arg: Node,
  sf: SourceFile,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
  bindings: Bindings,
  project: Project,
): Facts {
  if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
    return collectReachable(arg, sf, maxDepth, new Set([arg]), cache);
  }
  // Resolve a handler reference (`controller.login` / `handler`) to its function definition,
  // which may live in another file. Try our cross-file resolver first (it covers CommonJS),
  // then fall back to the TypeScript checker for cases it resolves better (ESM object methods).
  const cross = resolveCrossFileHandlerScope(arg, sf, bindings, project);
  if (cross) {
    return collectReachable(cross, cross.getSourceFile(), maxDepth, new Set([cross]), cache);
  }
  const ref = Node.isPropertyAccessExpression(arg) ? arg.getNameNode() : arg;
  if (Node.isIdentifier(ref)) {
    try {
      for (const def of ref.getDefinitionNodes()) {
        const scope = functionScopeOf(def);
        if (scope) {
          return collectReachable(scope, scope.getSourceFile(), maxDepth, new Set([scope]), cache);
        }
      }
    } catch {
      /* unresolved */
    }
  }
  return { sinks: new Set(), hasLimiter: false };
}

interface ExpressMountInfo {
  /** Posix paths of router files mounted under a limiter that covers the mount path. */
  readonly coveredRouterFiles: ReadonlySet<string>;
  /** Posix paths of router files that are mounted somewhere we could resolve. */
  readonly mountedRouterFiles: ReadonlySet<string>;
}

/** The relative-module target file of a mount arg (`require("./x")` or an imported router id). */
function resolveMountTargetFile(
  arg: Node,
  sf: SourceFile,
  bindings: Bindings,
  project: Project,
): SourceFile | undefined {
  const reqMod = requireModuleSpecifier(arg);
  if (reqMod && reqMod.startsWith(".")) return resolveRelativeModule(project, sf, reqMod);
  if (Node.isIdentifier(arg)) {
    const mb = bindings.moduleBindings.get(arg.getText());
    if (mb && mb.module.startsWith(".")) return resolveRelativeModule(project, sf, mb.module);
  }
  return undefined;
}

/**
 * Cross-file Express mount resolution (D034 follow-up, D041). Walks every `app.use(...)` to
 * tie a mounted router (in another file, via `require`/import) to its mount path, and records
 * whether an app-level limiter's path prefix covers that mount (or a route-level limiter sits
 * on it). This makes a router mounted under a path-scoped limiter (`app.use("/api", rateLimit())`
 * then `app.use("/api/x", require("./routes/x"))`) precisely covered, while a router mounted with
 * no covering limiter still flags.
 */
function resolveExpressMounts(
  files: readonly SourceFile[],
  project: Project,
  cache: Map<SourceFile, Bindings>,
): ExpressMountInfo {
  const coveredRouterFiles = new Set<string>();
  const mountedRouterFiles = new Set<string>();
  for (const sf of files) {
    const bindings = getBindings(sf, cache);
    const { instances, limiterVars } = expressBindings(sf, bindings);
    if (instances.size === 0) continue;

    // App-level limiter prefixes per instance (from `app.use([path,] limiter)`).
    const limiterPrefixes = new Map<string, string[]>();
    // Mounts: `app.use(mountPath, ...mw, routerRef)`.
    const mounts: { obj: string; mountPath: string; rest: Node[] }[] = [];
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "use") continue;
      const obj = rootIdent(callee.getExpression());
      if (!obj || !instances.has(obj)) continue;
      const args = call.getArguments();
      const first = args[0];
      const hasPath = first !== undefined && Node.isStringLiteral(first);
      const prefix = first && Node.isStringLiteral(first) ? first.getLiteralValue() : "";
      const mw = hasPath ? args.slice(1) : args;
      if (mw.some((a) => isExpressLimiterArg(a, bindings, limiterVars, sf, project, cache))) {
        const arr = limiterPrefixes.get(obj) ?? [];
        arr.push(prefix);
        limiterPrefixes.set(obj, arr);
      }
      if (hasPath) mounts.push({ obj, mountPath: prefix, rest: mw });
    }

    for (const { obj, mountPath, rest } of mounts) {
      for (const arg of rest) {
        const target = resolveMountTargetFile(arg, sf, bindings, project);
        if (!target) continue;
        const tp = toPosix(target.getFilePath());
        mountedRouterFiles.add(tp);
        const routeLevelLimiter = rest.some(
          (a) => a !== arg && isExpressLimiterArg(a, bindings, limiterVars, sf, project, cache),
        );
        const appCovers = (limiterPrefixes.get(obj) ?? []).some(
          (p) => p === "" || mountPath === p || mountPath.startsWith(p + "/"),
        );
        if (routeLevelLimiter || appCovers) coveredRouterFiles.add(tp);
      }
    }
  }
  return { coveredRouterFiles, mountedRouterFiles };
}

function modelExpress(
  sf: SourceFile,
  root: string,
  maxDepth: number,
  cache: Map<SourceFile, Bindings>,
  project: Project,
  mounts: ExpressMountInfo,
  projectHasNoPathAppLimiter: boolean,
): RouteModel[] {
  const bindings = getBindings(sf, cache);
  const { instances, apps, limiterVars } = expressBindings(sf, bindings);
  if (instances.size === 0) return [];
  const relFile = toPosix(relative(root, sf.getFilePath()));

  // Global/path limiters applied via `app.use([path,] limiter)`.
  const globalPrefixes: string[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "use") continue;
    const obj = rootIdent(callee.getExpression());
    if (!obj || !instances.has(obj)) continue;
    const args = call.getArguments();
    let prefix = "";
    let mwArgs = args;
    if (args[0] && Node.isStringLiteral(args[0])) {
      prefix = args[0].getLiteralValue();
      mwArgs = args.slice(1);
    }
    if (mwArgs.some((a) => isExpressLimiterArg(a, bindings, limiterVars, sf, project, cache)))
      globalPrefixes.push(prefix);
  }
  const globalCovers = (routePath: string): boolean =>
    globalPrefixes.some((p) => p === "" || routePath === p || routePath.startsWith(p + "/"));

  const routes: RouteModel[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const method = callee.getName();
    if (!EXPRESS_METHODS.has(method)) continue;
    const obj = rootIdent(callee.getExpression());
    if (!obj || !instances.has(obj)) continue;

    const args = call.getArguments();
    let routePath = "/";
    let routeArgs = args;
    if (args[0] && Node.isStringLiteral(args[0])) {
      routePath = args[0].getLiteralValue();
      routeArgs = args.slice(1);
    }

    let routeLevelLimiter = false;
    let inHandlerLimiter = false;
    const sinks = new Set<SinkCategory>();
    for (const a of routeArgs) {
      if (isExpressLimiterArg(a, bindings, limiterVars, sf, project, cache)) {
        routeLevelLimiter = true;
        continue;
      }
      const facts = factsForHandlerArg(a, sf, maxDepth, cache, bindings, project);
      for (const s of facts.sinks) sinks.add(s);
      if (facts.hasLimiter) inHandlerLimiter = true;
    }
    if (sinks.size === 0) continue; // not a sensitive endpoint

    // A route on a router (express.Router()) is usually mounted on an app in another file.
    // Use the cross-file mount resolution (D041): if this router file is mounted under a
    // covering limiter, it is covered; if it is mounted but not covered, flag it (a genuine
    // exposure); if its mount could not be resolved, fall back to the conservative rule (a
    // no-path app-wide limiter anywhere presumes coverage, favoring no false positives).
    const onRouter = !apps.has(obj);
    let presumedCovered = false;
    if (onRouter) {
      const filePosix = toPosix(sf.getFilePath());
      if (mounts.coveredRouterFiles.has(filePosix)) presumedCovered = true;
      else if (mounts.mountedRouterFiles.has(filePosix)) presumedCovered = false;
      else presumedCovered = projectHasNoPathAppLimiter;
    }

    routes.push({
      relFile,
      routePath,
      method: method.toUpperCase(),
      line: call.getStartLineNumber(),
      sinks: [...sinks],
      reachableLimiter:
        routeLevelLimiter || inHandlerLimiter || globalCovers(routePath) || presumedCovered,
      unknownWrapper: undefined,
    });
  }
  return routes;
}

// --- Money / Stripe idempotency (Detector 2a) ------------------------------------------
// Per-call, intraprocedural: in a file that imports `stripe`, a `<...>.<resource>.create(...)`
// for an idempotency-relevant resource should pass an idempotency key in the second
// (RequestOptions) argument. Missing it risks a double-charge on retry / webhook redelivery.

/** Does a Stripe create-call carry an idempotency key? Conservative: an unresolvable options
 * argument is treated as present, so only a confidently-absent key is reported. */
function createCallHasIdempotencyKey(call: CallExpression): boolean {
  const args = call.getArguments();
  if (args.length < 2) return false; // no RequestOptions argument at all
  const opts = args[1];
  if (Node.isObjectLiteralExpression(opts)) return opts.getProperty("idempotencyKey") !== undefined;
  return true; // a variable/spread we cannot inspect: assume it may carry the key (precision)
}

/** True if any file in the project imports a payment package (e.g. `stripe`). */
function projectUsesPaymentPackage(
  files: readonly SourceFile[],
  cache: Map<SourceFile, Bindings>,
): boolean {
  for (const sf of files) {
    for (const mod of getBindings(sf, cache).importModule.values()) {
      if (PAYMENT_PACKAGES.has(mod)) return true;
    }
  }
  return false;
}

// Precision guard is project-level (the project depends on stripe), not per-file, because the
// Stripe instance is often imported from a local wrapper (`import { stripe } from "@/lib/stripe"`).
// The matched resource paths (paymentIntents, checkout.sessions, ...) are Stripe-specific, so
// within a Stripe project this stays precise while catching the common wrapper pattern.
function modelStripeCalls(sf: SourceFile, root: string): StripeCreateCall[] {
  const relFile = toPosix(relative(root, sf.getFilePath()));
  const calls: StripeCreateCall[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "create") continue;
    const receiver = callee.getExpression().getText(); // chain before `.create`
    const resource = STRIPE_IDEMPOTENT_RESOURCES.find(
      (r) => receiver === r || receiver.endsWith("." + r),
    );
    if (!resource) continue;
    calls.push({
      relFile,
      line: call.getStartLineNumber(),
      resource,
      hasIdempotencyKey: createCallHasIdempotencyKey(call),
    });
  }
  return calls;
}

/**
 * Detector 3: a `NEXT_PUBLIC_<secret>` env var read via `process.env`. Next.js inlines every
 * NEXT_PUBLIC_ value into the client bundle, so a secret-named one is exposed to the browser. We
 * match `process.env.NEXT_PUBLIC_X` property access where X is unambiguously a secret name
 * (isClientExposedSecretName), deduped per file by name. (Element access `process.env["X"]` and
 * destructuring are documented gaps.)
 */
function modelClientExposedSecrets(sf: SourceFile, root: string): ExposedSecret[] {
  const relFile = toPosix(relative(root, sf.getFilePath()));
  const seen = new Set<string>();
  const out: ExposedSecret[] = [];
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const name = pae.getName();
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    if (pae.getExpression().getText() !== "process.env") continue;
    if (seen.has(name) || !isClientExposedSecretName(name)) continue;
    seen.add(name);
    out.push({ relFile, line: pae.getStartLineNumber(), varName: name });
  }
  return out;
}

/** Read baseUrl/paths from the target repo's tsconfig so `@/...` alias imports resolve. */
function readTargetTsPaths(rootDir: string): {
  baseUrl: string | undefined;
  paths: Record<string, string[]> | undefined;
} {
  const p = join(rootDir, "tsconfig.json");
  if (!existsSync(p)) return { baseUrl: undefined, paths: undefined };
  try {
    const { config, error } = ts.parseConfigFileTextToJson(p, readFileSync(p, "utf8"));
    if (error || !config) return { baseUrl: undefined, paths: undefined };
    const co = (
      config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    ).compilerOptions;
    return { baseUrl: co?.baseUrl, paths: co?.paths };
  } catch {
    return { baseUrl: undefined, paths: undefined };
  }
}

export function buildModel(rootDir: string, options: BuildOptions = {}): ProjectModel {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const { baseUrl, paths } = readTargetTsPaths(rootDir);
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
  };
  if (paths) {
    compilerOptions.paths = paths;
    compilerOptions.baseUrl = baseUrl ? resolve(rootDir, baseUrl) : rootDir;
  } else if (baseUrl) {
    compilerOptions.baseUrl = resolve(rootDir, baseUrl);
  }

  const project = new Project({ compilerOptions, skipAddingFilesFromTsConfig: true });
  // Scan the project's own source only. Excluding dependencies and build output is essential:
  // an installed project's node_modules would otherwise be parsed (huge cost) and could
  // produce findings from dependency code.
  const root = toPosix(rootDir);
  project.addSourceFilesAtPaths([
    `${root}/**/*.{ts,tsx,js,jsx,mjs,cjs}`,
    `!${root}/**/node_modules/**`,
    `!${root}/**/dist/**`,
    `!${root}/**/build/**`,
    `!${root}/**/.next/**`,
    `!${root}/**/out/**`,
    `!${root}/**/coverage/**`,
  ]);

  const cache = new Map<SourceFile, Bindings>();
  const sourceFiles = project.getSourceFiles();
  // Cross-file Express mount graph: which router files are mounted, and which under a limiter.
  const expressMounts = resolveExpressMounts(sourceFiles, project, cache);
  // Conservative fallback for routers whose mount we could not resolve: a no-path app-wide
  // limiter anywhere presumes coverage.
  const projectHasNoPathAppLimiter = sourceFiles.some((sf) =>
    hasGlobalAppLimiter(sf, project, cache),
  );
  // Detector 2a runs only when the project actually depends on a payment package.
  const usesPayment = projectUsesPaymentPackage(sourceFiles, cache);

  const routes: RouteModel[] = [];
  const stripeCalls: StripeCreateCall[] = [];
  const exposedSecrets: ExposedSecret[] = [];
  const clientSideApiCalls: ClientApiCall[] = [];
  let middleware: MiddlewareModel | undefined;
  for (const sf of sourceFiles) {
    const path = toPosix(sf.getFilePath());
    if (ROUTE_FILE.test(path)) {
      routes.push(...modelRoutes(sf, rootDir, maxDepth, cache));
    } else if (MIDDLEWARE_FILE.test(path) && !path.includes("/app/")) {
      middleware = modelMiddleware(sf, rootDir, maxDepth, cache);
    }
    // Express routes and Next.js server actions can live in any file; check every source file.
    routes.push(
      ...modelExpress(
        sf,
        rootDir,
        maxDepth,
        cache,
        project,
        expressMounts,
        projectHasNoPathAppLimiter,
      ),
    );
    routes.push(...modelServerActions(sf, rootDir, maxDepth, cache));
    routes.push(...modelInlineServerActions(sf, rootDir, maxDepth, cache));
    routes.push(...modelNextAuthCredentials(sf, rootDir, maxDepth, cache));
    // Stripe idempotency (Detector 2a): per-call, in any file, when the project uses Stripe.
    if (usesPayment) stripeCalls.push(...modelStripeCalls(sf, rootDir));
    // Client-exposed secrets (Detector 3): a NEXT_PUBLIC_<secret> env var, in any file.
    exposedSecrets.push(...modelClientExposedSecrets(sf, rootDir));
    // Client-side paid-API calls (D054): a fetch to an LLM host from public/ or a "use client" file.
    clientSideApiCalls.push(...modelClientSideAiCalls(sf, rootDir));
  }
  return { routes, middleware, stripeCalls, exposedSecrets, clientSideApiCalls };
}
