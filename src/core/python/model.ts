// SPDX-License-Identifier: Apache-2.0
// FastAPI route model (Detector 1). For each decorated function that registers a route
// (`@router.post("/x")`), record the HTTP method/path, whether a rate limiter covers it, and the
// sink its handler reaches - computed by cross-file reachability (project.ts), since real FastAPI
// handlers delegate to a service layer rather than inlining the sink.

import type { SinkCategory } from "../types.js";
import { type PyNode, descendantsOfType } from "./parse.js";
import { PY_LIMITER_DECORATOR_RE, PY_LIMITER_DEPENDS_RE, PY_HTTP_METHODS } from "./catalogues.js";
import { type FileIndex, type ProjectIndex, handlerReachesSink } from "./project.js";

export interface PyRoute {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly line: number;
  readonly sink: SinkCategory | undefined;
  readonly limited: boolean;
}

const ROUTE_METHOD_RE = /@\s*[\w.]+\.(get|post|put|patch|delete)\b/;
const ROUTE_PATH_RE = /\(\s*[rfb]?(['"])([^'"]*)\1/;

function parseRouteDecorator(
  decorators: PyNode[],
): { method: string; path: string; line: number } | undefined {
  for (const d of decorators) {
    const m = ROUTE_METHOD_RE.exec(d.text);
    if (!m || !m[1] || !PY_HTTP_METHODS.has(m[1])) continue;
    const p = ROUTE_PATH_RE.exec(d.text);
    return { method: m[1], path: p?.[2] ?? "", line: d.startPosition.row + 1 };
  }
  return undefined;
}

/** Extract the routes registered in a file and resolve each handler's reachable sink + limiter. */
export function modelRoutes(file: FileIndex, index: ProjectIndex): PyRoute[] {
  const routes: PyRoute[] = [];
  for (const dec of descendantsOfType(file.root, "decorated_definition")) {
    const decorators: PyNode[] = [];
    let fn: PyNode | undefined;
    for (let i = 0; i < dec.childCount; i++) {
      const c = dec.child(i);
      if (!c) continue;
      if (c.type === "decorator") decorators.push(c);
      else if (c.type === "function_definition") fn = c;
    }
    if (!fn) continue;
    const route = parseRouteDecorator(decorators);
    if (!route) continue;
    const params = fn.childForFieldName("parameters");
    const limited =
      decorators.some(
        (d) => PY_LIMITER_DECORATOR_RE.test(d.text) || PY_LIMITER_DEPENDS_RE.test(d.text),
      ) || (params ? PY_LIMITER_DEPENDS_RE.test(params.text) : false);
    routes.push({
      name: fn.childForFieldName("name")?.text ?? "?",
      method: route.method,
      path: route.path,
      line: route.line,
      sink: handlerReachesSink(fn, file, index),
      limited,
    });
  }
  return routes;
}
