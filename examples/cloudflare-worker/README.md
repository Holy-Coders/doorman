# Cloudflare Workers

Run a page and `/api/visitor` endpoint in one Worker, with D1 storage. The local example needs no Cloudflare account or AI credentials. It uses the 0.13 API from the source workspace.

## Run the example

You need Node.js 22.12+, pnpm 9.12.0 and a checkout of [Doorman](https://github.com/Holy-Coders/doorman). From the repository root:

```sh
pnpm install
pnpm build
cd examples/cloudflare-worker
openssl rand -hex 32 | sed 's/^/DOORMAN_IDENTITY_SECRET=/' > .dev.vars
pnpm dev
```

Generate the secret once on a fresh checkout; keep `.dev.vars` private and reuse it. Open **http://localhost:8787** and select **Identify** twice. The first visit creates a browser ID, the second reuses its cookie. Doorman creates its database tables automatically.

AI is disabled. No Jev requests are made. The browser response contains `{ visitorId, sessionId, isReturning }`; possible matches and scores remain on the server.

## Add it to your Worker

[Install the packages](../../docs/LANGUAGES.md). Bind a D1 database as `VISITORS` and set a server secret named `DOORMAN_IDENTITY_SECRET`. The connection initializes its own tables; no migration command is needed.

```ts
import { createDoorman } from "@aarondovturkel/doorman-adapters/cloudflare";

let doorman: ReturnType<typeof createDoorman> | undefined;

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/visitor") {
      doorman ??= createDoorman({
        db: env.VISITORS,
        secret: env.DOORMAN_IDENTITY_SECRET,
        namespace: "my-app",
      });
      return doorman.handle(request);
    }
    return env.ASSETS.fetch(request); // Or your existing routing.
  },
};
```

Reuse the handler within the Worker instance. Add [the browser client and login context](../../docs/IDENTITY-CONTEXT.md) next. Use `assess()` when you need private results; return its `response` to the browser.

## Optional Jev scoring

Add `ai: env.AI` to the configuration and bind Workers AI. No separate TypeSafe API key is required. Provider usage can incur charges; configure your account's Jev access before enabling it.

The example enables AI only when `JEV_ENABLED=true`. `pnpm dev:ai` uses the remote provider. Plain `pnpm dev` makes no AI calls. Read [Jev setup and scoring limits](../../docs/JEV.md).

## Deploy

Create a D1 database and put its ID in the example's Wrangler config. Save the production secret:

```sh
pnpm exec wrangler secret put DOORMAN_IDENTITY_SECRET
pnpm build
pnpm exec wrangler deploy
```

`pnpm build` bundles the browser and checks the Worker without deploying. The deployed handler sets up its tables on first use. Use a separate database for each application and HTTPS in production. Call `doorman.cleanup()` from an existing maintenance task. [Storage and retention](../../site/content/storage.md).
