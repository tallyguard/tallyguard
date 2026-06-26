import { defineConfig } from "tsup";

// Builds the library entry and the CLI bin. The CLI keeps its shebang so the published
// `tallyguard` bin is directly executable.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
    "app/probot-app": "src/app/probot-app.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  // Type declarations are deferred: the dts toolchain trips on a TypeScript 6 preview
  // deprecation, and there are no external type consumers yet (the CLI bin is the artifact).
  // Re-enable when publishing the library, e.g. via `tsc --emitDeclarationOnly`.
  dts: false,
  sourcemap: true,
});
