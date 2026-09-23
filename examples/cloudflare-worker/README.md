# Cloudflare Worker example

From the repository root:

```sh
pnpm install
pnpm build
cd examples/cloudflare-worker
pnpm exec wrangler d1 migrations apply VISITORS --local
pnpm dev
```

Open http://localhost:8787 and select Identify. Wrangler uses a local D1 database. `migrations_dir` points to the shipped D1 migration. Browser JavaScript is bundled locally with esbuild; no CDN dependency.

`JEV_ENABLED` defaults to `false`, so local boot makes no AI requests and returns conservative zero risk. The default `pnpm dev` uses `wrangler dev --local`, disabling remote bindings entirely. To opt into real Workers AI evaluation locally, run `pnpm dev:ai`; for deployment, set `JEV_ENABLED` to `true` in Wrangler variables. The `AI` binding then invokes `typesafe/jev`; no TypeSafe API key is needed. Workers AI inference uses the remote service even during local development and may incur charges. No live inference is performed by tests.

For deployment, create your D1 database, replace the placeholder `database_id`, apply the migration remotely, configure the AI binding/variable, and deploy using your application's normal release process. `pnpm build` only bundles and runs `wrangler deploy --dry-run`; it does not deploy anything.

The endpoint is `/api/visitor`; other requests serve the tiny static browser example. Cleanup is intentionally not scheduled. Call `createCloudflareVisitor({ db: env.VISITORS }).cleanup()` from existing maintenance when appropriate. Use HTTPS for deployed cookies.
