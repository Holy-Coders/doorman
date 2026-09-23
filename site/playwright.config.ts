import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../tests/site",
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4357", browserName: "chromium" },
  webServer: {
    command: "node tests/site/server.mjs",
    cwd: "..",
    url: "http://127.0.0.1:4357",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
