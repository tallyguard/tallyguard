// SPDX-License-Identifier: Apache-2.0
// Cross-file reachability for the FastAPI analyzer. Real handlers delegate to a service layer, so a
// route is sensitive when its handler TRANSITIVELY reaches a catalogued sink:
//   handler -> imported function / instance method / self method -> ... -> sink   (depth-bounded).
// tree-sitter has no symbol table, so we resolve calls structurally: each file is indexed for its
// imports, top-level functions, classes/methods, sink-instance bindings, and variables bound to a
// project class. Precision-first: a call we cannot resolve is simply not followed - a missed
// detection, never a false positive.

import type { SinkCategory } from "../types.js";
import { type PyNode, descendantsOfType, rootIdentifier, lastIdentifier, walk } from "./parse.js";
import { PY_SINK_CONSTRUCTORS, PY_SINK_MODULES } from "./catalogues.js";

const MAX_DEPTH = 5;

interface ImportBinding {
  readonly module: string; // dotted module path, no leading dots
  readonly name: string; // imported symbol (original), "" for `import module`
  readonly level: number; // relative-import dots (0 = absolute)
  readonly isModule: boolean; // `import x` (bound name is a module) vs `from m import x`
}

export interface FileIndex {
  readonly rel: string;
  readonly root: PyNode;
  readonly imports: Map<string, ImportBinding>;
  readonly functions: Map<string, PyNode>; // top-level def name -> function_definition
  readonly classes: Map<string, Map<string, PyNode>>; // class -> (method -> def)
  readonly sinkVars: Map<string, SinkCategory>; // module-level sink instances
  readonly sinkModules: Map<string, SinkCategory>;
  readonly varClasses: Map<string, string>; // module-level var -> project class name
}

export interface ProjectIndex {
  readonly files: readonly FileIndex[];
  readonly byRel: Map<string, FileIndex>;
}

interface Bindings {
  readonly sinkVars: Map<string, SinkCategory>;
  readonly varClasses: Map<string, string>;
}

function funcOfDecorated(node: PyNode): PyNode | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === "function_definition") return c;
  }
  return undefined;
}

function isInsideClass(node: PyNode): boolean {
  let p = node.parent;
  while (p) {
    if (p.type === "class_definition") return true;
    if (p.type === "function_definition") return false; // a nested def in a method is still "in class", but we only care about top-level vs method
    p = p.parent;
  }
  return false;
}

function parseModuleName(node: PyNode | null): { module: string; level: number } {
  if (!node) return { module: "", level: 0 };
  if (node.type === "dotted_name") return { module: node.text, level: 0 };
  if (node.type === "relative_import") {
    const prefix = node.child(0); // import_prefix (the dots)
    const level = prefix ? prefix.text.length : 1;
    const dotted = descendantsOfType(node, "dotted_name")[0];
    return { module: dotted?.text ?? "", level };
  }
  return { module: node.text, level: 0 };
}

/** Strip generics/Optional to a base class name: `Optional[AuthService]` -> `AuthService`. */
function baseClassName(typeText: string): string | undefined {
  const inner = /\[([^\]]+)\]/.exec(typeText);
  const candidate = (inner?.[1] ?? typeText).split(",")[0]?.trim() ?? "";
  const id = /([A-Za-z_]\w*)\s*$/.exec(candidate)?.[1];
  return id && /^[A-Z]/.test(id) ? id : undefined;
}

/** Collect sink-instance + var->class bindings within a scope (a file root or a function body),
 *  layered on top of `base` (module-level bindings). */
function collectBindings(scope: PyNode, base?: Bindings): Bindings {
  const sinkVars = new Map(base?.sinkVars);
  const varClasses = new Map(base?.varClasses);
  for (const asn of descendantsOfType(scope, "assignment")) {
    const left = asn.childForFieldName("left");
    if (!left || left.type !== "identifier") continue;
    const typeNode = asn.childForFieldName("type");
    if (typeNode) {
      const cn = baseClassName(typeNode.text);
      if (cn) varClasses.set(left.text, cn);
    }
    const right = asn.childForFieldName("right");
    if (right?.type === "call") {
      const ctor = lastIdentifier(right.childForFieldName("function"));
      if (ctor) {
        const sc = PY_SINK_CONSTRUCTORS[ctor];
        if (sc) sinkVars.set(left.text, sc);
        else if (/^[A-Z]/.test(ctor)) varClasses.set(left.text, ctor);
      }
    }
  }
  return { sinkVars, varClasses };
}

/** Parameter annotations of a function: `service: AuthService = Depends(...)` -> service is AuthService. */
function paramClasses(fn: PyNode, into: Map<string, string>): void {
  const params = fn.childForFieldName("parameters");
  if (!params) return;
  for (const t of [
    ...descendantsOfType(params, "typed_parameter"),
    ...descendantsOfType(params, "typed_default_parameter"),
  ]) {
    const name = descendantsOfType(t, "identifier")[0]?.text;
    const type = t.childForFieldName("type")?.text;
    if (!name || !type) continue;
    const cn = baseClassName(type);
    if (cn) into.set(name, cn);
  }
}

export function indexFile(rel: string, root: PyNode): FileIndex {
  const imports = new Map<string, ImportBinding>();

  for (const stmt of descendantsOfType(root, "import_statement")) {
    for (const n of stmt.childrenForFieldName("name")) {
      if (n.type === "dotted_name") {
        const bound = n.text.split(".")[0] ?? n.text;
        imports.set(bound, { module: n.text, name: "", level: 0, isModule: true });
      } else if (n.type === "aliased_import") {
        const mod = n.childForFieldName("name")?.text ?? "";
        const alias = n.childForFieldName("alias")?.text;
        if (alias) imports.set(alias, { module: mod, name: "", level: 0, isModule: true });
      }
    }
  }
  for (const stmt of descendantsOfType(root, "import_from_statement")) {
    const { module, level } = parseModuleName(stmt.childForFieldName("module_name"));
    for (const n of stmt.childrenForFieldName("name")) {
      if (n.type === "dotted_name") {
        imports.set(n.text, { module, name: n.text, level, isModule: false });
      } else if (n.type === "aliased_import") {
        const orig = n.childForFieldName("name")?.text ?? "";
        const alias = n.childForFieldName("alias")?.text;
        if (alias && orig) imports.set(alias, { module, name: orig, level, isModule: false });
      }
    }
  }

  const classes = new Map<string, Map<string, PyNode>>();
  for (const cls of descendantsOfType(root, "class_definition")) {
    const cname = cls.childForFieldName("name")?.text;
    const body = cls.childForFieldName("body");
    if (!cname || !body) continue;
    const methods = new Map<string, PyNode>();
    for (let i = 0; i < body.childCount; i++) {
      const c = body.child(i);
      if (!c) continue;
      const fn =
        c.type === "function_definition"
          ? c
          : c.type === "decorated_definition"
            ? funcOfDecorated(c)
            : undefined;
      const mn = fn?.childForFieldName("name")?.text;
      if (fn && mn) methods.set(mn, fn);
    }
    classes.set(cname, methods);
  }

  const functions = new Map<string, PyNode>();
  for (const fn of descendantsOfType(root, "function_definition")) {
    if (isInsideClass(fn)) continue;
    const n = fn.childForFieldName("name")?.text;
    if (n && !functions.has(n)) functions.set(n, fn);
  }

  const { sinkVars, varClasses } = collectBindings(root);
  // module-level sink modules (imports of catalogued modules)
  const sinkModules = new Map<string, SinkCategory>();
  for (const [bound, imp] of imports) {
    if (imp.isModule) {
      const cat = PY_SINK_MODULES[imp.module.split(".")[0] ?? ""];
      if (cat) sinkModules.set(bound, cat);
    }
  }

  return { rel, root, imports, functions, classes, sinkVars, sinkModules, varClasses };
}

export function buildProjectIndex(parsed: readonly { rel: string; root: PyNode }[]): ProjectIndex {
  const files = parsed.map((p) => indexFile(p.rel, p.root));
  const byRel = new Map(files.map((f) => [f.rel, f]));
  return { files, byRel };
}

function findByModulePath(modulePath: string, index: ProjectIndex): FileIndex | undefined {
  const direct =
    index.byRel.get(modulePath + ".py") ?? index.byRel.get(modulePath + "/__init__.py");
  if (direct) return direct;
  // suffix match, dropping leading components (handles a scanned sub-package), longest unique wins
  const comps = modulePath.split("/");
  for (let start = 0; start < comps.length; start++) {
    const suffix = comps.slice(start).join("/");
    for (const tail of [suffix + ".py", suffix + "/__init__.py"]) {
      const matches = index.files.filter((f) => f.rel === tail || f.rel.endsWith("/" + tail));
      if (matches.length === 1) return matches[0];
    }
  }
  return undefined;
}

function resolveModuleFile(
  from: FileIndex,
  imp: ImportBinding,
  index: ProjectIndex,
): FileIndex | undefined {
  if (imp.level > 0) {
    const dir = from.rel.split("/").slice(0, -1);
    for (let i = 1; i < imp.level; i++) dir.pop();
    const mod = imp.module ? imp.module.split(".") : [];
    return findByModulePath([...dir, ...mod].join("/"), index);
  }
  return findByModulePath(imp.module.split(".").join("/"), index);
}

function resolveClass(
  className: string,
  ctx: FileIndex,
  index: ProjectIndex,
): { ctx: FileIndex; methods: Map<string, PyNode> } | undefined {
  const local = ctx.classes.get(className);
  if (local) return { ctx, methods: local };
  const imp = ctx.imports.get(className);
  if (imp && !imp.isModule) {
    const tgt = resolveModuleFile(ctx, imp, index);
    const methods = tgt?.classes.get(imp.name);
    if (tgt && methods) return { ctx: tgt, methods };
  }
  return undefined;
}

/** Does `handler` transitively reach a catalogued sink? Returns the sink category or undefined. */
export function handlerReachesSink(
  handler: PyNode,
  ctx: FileIndex,
  index: ProjectIndex,
): SinkCategory | undefined {
  return reach(handler, ctx, index, 0, new Set(), undefined);
}

function reach(
  fn: PyNode,
  ctx: FileIndex,
  index: ProjectIndex,
  depth: number,
  visited: Set<number>,
  classMethods: Map<string, PyNode> | undefined,
): SinkCategory | undefined {
  if (depth > MAX_DEPTH || visited.has(fn.id)) return undefined;
  visited.add(fn.id);
  const local = collectBindings(fn, { sinkVars: ctx.sinkVars, varClasses: ctx.varClasses });
  paramClasses(fn, local.varClasses);

  let result: SinkCategory | undefined;
  walk(fn, (n) => {
    if (result || n.type !== "call") return;
    result = resolveCall(n, ctx, local, index, depth, visited, classMethods);
  });
  return result;
}

function resolveCall(
  call: PyNode,
  ctx: FileIndex,
  local: Bindings,
  index: ProjectIndex,
  depth: number,
  visited: Set<number>,
  classMethods: Map<string, PyNode> | undefined,
): SinkCategory | undefined {
  const callee = call.childForFieldName("function");
  if (!callee) return undefined;

  if (callee.type === "identifier") {
    const name = callee.text;
    const localFn = ctx.functions.get(name);
    if (localFn) return reach(localFn, ctx, index, depth + 1, visited, undefined);
    const imp = ctx.imports.get(name);
    if (imp && !imp.isModule) {
      const tgt = resolveModuleFile(ctx, imp, index);
      const tfn = tgt?.functions.get(imp.name);
      if (tgt && tfn) return reach(tfn, tgt, index, depth + 1, visited, undefined);
    }
    return undefined;
  }

  if (callee.type === "attribute") {
    const objRoot = rootIdentifier(callee.childForFieldName("object"));
    const method = callee.childForFieldName("attribute")?.text;
    if (!objRoot || !method) return undefined;

    // base sink: receiver is a sink instance (pwd_context.verify) or sink module (bcrypt.checkpw)
    const base = local.sinkVars.get(objRoot) ?? ctx.sinkModules.get(objRoot);
    if (base) return base;

    // self.method() -> sibling method
    if (objRoot === "self" && classMethods) {
      const m = classMethods.get(method);
      return m ? reach(m, ctx, index, depth + 1, visited, classMethods) : undefined;
    }
    // imported module: module.func()
    const imp = ctx.imports.get(objRoot);
    if (imp?.isModule) {
      const tgt = resolveModuleFile(ctx, imp, index);
      const tfn = tgt?.functions.get(method);
      if (tgt && tfn) return reach(tfn, tgt, index, depth + 1, visited, undefined);
      return undefined;
    }
    // instance method: obj's class -> method
    const className = local.varClasses.get(objRoot);
    if (className) {
      const cls = resolveClass(className, ctx, index);
      const m = cls?.methods.get(method);
      if (cls && m) return reach(m, cls.ctx, index, depth + 1, visited, cls.methods);
    }
    return undefined;
  }
  return undefined;
}
