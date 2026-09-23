# Node / Fastify example

Requires Node 22.12+, pnpm and Postgres. From the root:

```sh
pnpm install
pnpm build
docker compose -f examples/compose.yaml up -d --wait
cd examples/node-fastify
cp .env.example .env
pnpm migrate
pnpm dev
```

Open http://localhost:3001 and select Identify. `DATABASE_URL` is required. `JEV_API_KEY` is optional: blank means deterministic-only matching with zero risk defaults; a real key enables paid TypeSafe inference. `PORT` defaults to 3001; if changing it, also set `APP_ORIGIN` to the corresponding public origin. Production should use the canonical HTTPS origin behind your proxy.

`pnpm migrate` is idempotent and applies the shared SQL in a transaction. `pnpm dev` builds the browser bundle before starting Fastify. `src/app.ts` translates Fastify into the standard Request/Response adapter; the library never imports Fastify. Request logging is disabled, bodies are limited to 16 KiB, and the pool is closed on process shutdown.

The cookie defaults to Secure, including local operation (supported on localhost by Chromium). For other local browsers, use the explicit development/loopback exception documented in the root README. Do not disable Secure in production.

The two local examples share one identity database. In production, isolate each application in its own database or Postgres schema/search_path. Stop it with `docker compose -f examples/compose.yaml down` from the root; omit `-v` to preserve your local test history. Call `visitor.cleanup()` from your application's existing maintenance path.
