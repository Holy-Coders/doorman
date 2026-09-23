import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20000 },
  resolve: {
    alias: [
      {
        find: "@janitor/core",
        replacement: fileURLToPath(
          new URL("./packages/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@janitor/browser",
        replacement: fileURLToPath(
          new URL("./packages/browser/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@janitor/storage-d1",
        replacement: fileURLToPath(
          new URL("./packages/storage/d1/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@janitor/storage-postgres",
        replacement: fileURLToPath(
          new URL("./packages/storage/postgres/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@janitor/evaluator-jev",
        replacement: fileURLToPath(
          new URL("./packages/evaluators/jev/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@janitor/evaluator-cloudflare-jev",
        replacement: fileURLToPath(
          new URL(
            "./packages/evaluators/cloudflare-jev/src/index.ts",
            import.meta.url,
          ),
        ),
      },
      ...["node", "vercel", "cloudflare"].map((name) => ({
        find: "@janitor/adapters/" + name,
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
