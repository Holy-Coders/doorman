# Cloudflare Workers

This example runs Doorman in a Cloudflare Worker with D1, Cloudflare’s SQL database. It serves a small page and a `/api/visitor` endpoint. Local development uses a database on your machine and starts with AI disabled.

## Run the example

You need Node 22.12+, pnpm 9.12.0 and a checkout of the [Doorman repository](https://github.com/Holy-Coders/doorman). From its root:

```sh
pnpm install
pnpm build
cd examples/cloudflare-worker
pnpm exec wrangler d1 migrations apply VISITORS --local
pnpm dev
```

Open **http://localhost:8787** and select **Identify** twice. The first call creates a browser ID; the second should return the same ID using the cookie. The page’s JavaScript is bundled locally, with no CDN dependency.

## Add it to an existing Worker

Apply the [D1 migrations](../../packages/storage/d1/migrations) to your database, bind it as `VISITORS`, and mount the handler at your chosen route:

```ts
import { createCloudflareVisitor } from "@aarondovturkel/doorman-adapters/cloudflare";

const visitor = createCloudflareVisitor({ db: env.VISITORS });
return visitor.handle(request);
```

Use that response for `/api/visitor`; continue serving your other routes normally. Keep a reusable adapter per binding configuration, as the [example Worker](src/index.ts) does, so per-instance limits can apply across requests. Add the [browser client](../../docs/GETTING-STARTED.md) to your app and keep the endpoint on the same origin.

## Enable Jev when you need risk scores

Jev is TypeSafe’s AI model for structured judgments. On Cloudflare, it runs through the Workers AI `AI` binding without a separate TypeSafe API key:

```ts
createCloudflareVisitor({ db: env.VISITORS, ai: env.AI });
```

The example’s `JEV_ENABLED` variable defaults to `false`. To try real Workers AI during local development, run `pnpm dev:ai`. This uses the remote provider and can incur charges. Plain `pnpm dev` uses local bindings and makes no AI calls. Read [the scores and failure behavior](../../docs/JEV.md) before acting on a result.

## Deploy and maintain

Create your D1 database, replace the placeholder `database_id` in the Wrangler config, and apply the migrations remotely. Set `JEV_ENABLED=true` only if you want AI evaluation, then deploy through your normal Worker release process. `pnpm build` bundles and performs a dry run; it does not deploy.

Use HTTPS for cookies. Call `visitor.cleanup()` from existing maintenance to remove expired history. Use `visitor.assess(request)` if server code needs the private scores; `handle()` returns only the public visitor result. See [storage](../../site/content/storage.md) and [private assessments](../../docs/SECURITY.md).
