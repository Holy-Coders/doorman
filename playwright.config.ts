import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4318", browserName: "chromium" },
  webServer: {
    command: "pnpm exec tsx tests/e2e/server.ts",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
