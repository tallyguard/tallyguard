// SPDX-License-Identifier: Apache-2.0
// Python parser front-end for FastAPI Detector 1. Uses web-tree-sitter with the official
// tree-sitter-python grammar (a local .wasm shipped inside the tree-sitter-python package - no
// network, no Python runtime needed on the user's machine). The async init (wasm load) happens ONCE
// and is cached; parsing itself is synchronous, so detection stays deterministic and offline.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Parser, Language, type Node } from "web-tree-sitter";

const require = createRequire(import.meta.url);

let parserPromise: Promise<Parser> | undefined;

/** Load the Python parser once (cached). Async only because the wasm grammar loads asynchronously. */
export function getPythonParser(): Promise<Parser> {
  if (!parserPromise) parserPromise = initParser();
  return parserPromise;
}

async function initParser(): Promise<Parser> {
  await Parser.init();
  const parser = new Parser();
  // The grammar wasm ships inside tree-sitter-python; resolve it from the installed package so it
  // works both in dev and when Tallyguard is installed as a dependency.
  const pkgJson = require.resolve("tree-sitter-python/package.json");
  const wasmPath = join(dirname(pkgJson), "tree-sitter-python.wasm");
  const python = await Language.load(wasmPath);
  parser.setLanguage(python);
  return parser;
}

export type PyNode = Node;

/** Depth-first walk. Return `false` from `visit` to skip a node's children. */
export function walk(node: PyNode, visit: (n: PyNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) walk(c, visit);
  }
}

/** All descendant nodes of a given grammar type. */
export function descendantsOfType(root: PyNode, type: string): PyNode[] {
  const out: PyNode[] = [];
  walk(root, (n) => {
    if (n.type === type) out.push(n);
  });
  return out;
}

/** The root identifier of an attribute/call chain: `pwd` in `pwd.verify(...)`, `bcrypt` in
 *  `bcrypt.checkpw(...)`, `client` in `client.chat.completions.create(...)`. */
export function rootIdentifier(node: PyNode | null): string | undefined {
  let n = node;
  while (n) {
    if (n.type === "identifier") return n.text;
    if (n.type === "attribute") {
      n = n.childForFieldName("object");
      continue;
    }
    if (n.type === "call") {
      n = n.childForFieldName("function");
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** The final identifier of a (possibly dotted) name: `CryptContext` in `passlib.context.CryptContext`,
 *  `OpenAI` in `openai.OpenAI`, or the identifier itself. */
export function lastIdentifier(node: PyNode | null): string | undefined {
  if (!node) return undefined;
  if (node.type === "identifier") return node.text;
  if (node.type === "attribute") return node.childForFieldName("attribute")?.text;
  return undefined;
}
