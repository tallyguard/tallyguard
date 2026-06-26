// ESLint 10 flat config. Lints TypeScript across the repo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".venv/**",
      "coverage/**",
      "test-results/**",
      // Benchmark fixtures are deliberately flawed and import uninstalled packages.
      "benchmark/cases/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node scripts (the throwaway Phase 0 harness and any future tooling scripts).
    files: ["**/*.mjs", "**/*.cjs", "tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        Buffer: "readonly",
      },
    },
  },
);
