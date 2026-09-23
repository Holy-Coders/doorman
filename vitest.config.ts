import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20000 },
  resolve: {
    alias: [
      {
        find: "@aarondovturkel/doorman-core",
        replacement: fileURLToPath(
          new URL("./packages/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@aarondovturkel/doorman-browser",
        replacement: fileURLToPath(
          new URL("./packages/browser/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@aarondovturkel/doorman-storage-d1",
        replacement: fileURLToPath(
          new URL("./packages/storage/d1/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@aarondovturkel/doorman-storage-postgres",
        replacement: fileURLToPath(
          new URL("./packages/storage/postgres/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@aarondovturkel/doorman-evaluator-jev",
        replacement: fileURLToPath(
          new URL("./packages/evaluators/jev/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@aarondovturkel/doorman-evaluator-cloudflare-jev",
        replacement: fileURLToPath(
          new URL(
            "./packages/evaluators/cloudflare-jev/src/index.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@aarondovturkel/doorman-adapters/node/http",
        replacement: fileURLToPath(
          new URL("./packages/adapters/src/node/http.ts", import.meta.url),
        ),
      },
      ...["node", "vercel", "cloudflare"].map((name) => ({
        find: "@aarondovturkel/doorman-adapters/" + name,
        replacement: fileURLToPath(
          new URL(
            "./packages/adapters/src/" + name + "/index.ts",
            import.meta.url,
          ),
        ),
      })),
    ],
  },
});
