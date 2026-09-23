# Node and Fastify

Janitor’s Node adapter uses standard Web Request/Response objects. This example shows the small translation needed to mount it in Fastify. You can use the same adapter in another Node framework without adding that framework to Janitor itself.

## Run the example

You need Node 22.12+, pnpm 9.12.0 and Docker for the supplied Postgres database. From the Janitor repository root:

```sh
pnpm install
pnpm build
docker compose -f examples/compose.yaml up -d --wait
cd examples/node-fastify
cp .env.example .env
pnpm migrate
pnpm dev
```

Open **http://localhost:3001** and select **Identify** twice. The second response should use the cookie and return the same visitor ID. `pnpm dev` builds the browser client before starting Fastify.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required Postgres connection URL. The example file points to the supplied local database. |
| `JEV_API_KEY` | Optional TypeSafe key. Blank means no AI calls; a real key enables Jev and can incur provider charges. |
| `PORT` | Server port, default `3001`. |
| `APP_ORIGIN` | Your app’s public origin. Update it if you change the port; use the canonical HTTPS origin in production. |

## Mount it in your application

[Install the packages](../../docs/LANGUAGES.md) and apply the Postgres migrations, then create a reusable adapter:

```ts
import { Pool } from "pg";
import { createNodeVisitor } from "@janitor/adapters/node";

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const visitor = createNodeVisitor({ db, evaluator: false });

// In the route, after translating the framework request:
const response = await visitor.handle(request);
```

The [Fastify bridge](src/app.ts) shows request-body handling and copying the response status, headers and body back to Fastify. The example limits bodies to 16 KiB, disables request logging and closes the pool on shutdown.

Mount `/api/visitor` on your application’s origin and add the [browser client](../../docs/GETTING-STARTED.md). Replace `handle()` with `assess()` when your server needs [private scores](../../docs/SECURITY.md).

## Cookies and maintenance

Use HTTPS in production. The cookie is Secure by default; Chromium accepts it on localhost. For a local browser that does not, use the explicit development-only option `environment: "development", cookie: { secure: false }`. The adapter rejects that exception outside loopback or in production mode.

Run `visitor.cleanup()` from your existing maintenance task. Use a dedicated production database or schema per application. The local Node and Next.js examples share the supplied test database. Stop it with `docker compose -f examples/compose.yaml down` from the repository root; omit `-v` to keep local history.
