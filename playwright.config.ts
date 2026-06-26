import { defineConfig, devices } from "@playwright/test";

// Browser-driven E2E + screenshot verification for the web surfaces
// (the Phase 3 docs/benchmark site and the Phase 4 dashboard).
//
// This is the tooling behind the self-driven visual loop described in
// CLAUDE.md: run the surface, capture a screenshot, read it back, fix, repeat.
// It is NOT active yet: there is no runnable web surface in the repo today.
// The CLI is verified through Vitest golden-file + exit-code tests instead.
//
// When a web surface lands: create test/e2e specs, uncomment `webServer` so
// Playwright boots the dev server, and point `baseURL` at it.
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "./test-results",
  use: {
    baseURL: process.env.TALLYGUARD_E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // webServer: {
  //   command: "npm run dev",
  //   url: "http://localhost:3000",
  //   reuseExistingServer: !process.env.CI,
  // },
});
