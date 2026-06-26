import { defineConfig } from "vitest/config";

// Unit, integration, golden-file (snapshot), and CLI-output tests.
// Golden-file testing is the dominant pattern for a static analyzer: small
// input programs (vulnerable + matched-safe) asserted against the terminal,
// JSON, and SARIF outputs. See docs/DESIGN-STANDARD.md (Testing).
export default defineConfig({
  test: {
    // No test files exist yet (pre-code). Keep the suite green until the
    // first detector issue adds fixtures, instead of failing on an empty run.
    passWithNoTests: true,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Playwright owns browser/E2E specs; keep them out of the Vitest run.
    exclude: ["node_modules", "dist", "test/e2e/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.config.ts"],
    },
  },
});
