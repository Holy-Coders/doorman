# Your first visitor ID

Run a complete Doorman example on your machine. It includes a page, a browser client, an endpoint and a local database. You do not need a Cloudflare account, an AI key or Docker.

This guide uses the **upcoming 0.13 release from source**, so it works before package publication finishes. Prefer Phoenix? [Run the native Elixir example](../examples/phoenix/README.md).

## 1. Get the example

You need Git, Node.js 22.12+ and pnpm 9.12.0. From a terminal:

```sh
git clone https://github.com/Holy-Coders/doorman.git
cd doorman
corepack enable
pnpm install
pnpm build
cd examples/cloudflare-worker
```

The checkout includes all Doorman packages; no unpublished dependencies are fetched from npm. For other package managers and existing applications, see [installation and versions](LANGUAGES.md).

## 2. Set a local secret

Doorman uses a server secret to label account relationships without storing raw user IDs. Generate a local one:

```sh
openssl rand -hex 32 | sed 's/^/DOORMAN_IDENTITY_SECRET=/' > .dev.vars
```

Do this once on a fresh checkout. Keep the file private and reuse the value on later runs. Overwriting it would change the IDs derived from earlier logins. Never include it in browser code.

## 3. Start the app

```sh
pnpm dev
```

Open **http://localhost:8787**. AI is disabled, so this example makes no Jev requests. The database lives on your machine. Doorman creates its tables automatically on the first request.

## 4. Identify the browser twice

Select **Identify**. The first response looks like this:

```json
{
  "visitorId": "vis_…",
  "sessionId": "ses_…",
  "isReturning": false
}
```

Select **Identify** again. `visitorId` stays the same and `isReturning` becomes `true`. The server recognizes the cookie it set on the first response. `sessionId` groups recent visits; it is not your application's login session.

Delete the `__visitor` cookie in developer tools and try again. **The recommended API creates a fresh browser ID.** It may find a likely previous browser, but that suggestion stays private on the server. This avoids merging analytics users because two browsers look alike.

No one has logged in during this example. A returning browser does not prove who is using it.

## 5. Find the code

The example has two main pieces:

- [Browser client](../examples/cloudflare-worker/src/client.ts): creates `createDoormanClient({ endpoint: "/api/visitor" })` and calls `identify()` when you select the button.
- [Worker endpoint](../examples/cloudflare-worker/src/index.ts): creates `createDoorman({ db, secret, namespace })` once, then calls `handle(request)` for `/api/visitor`.

`handle()` sends the public JSON and cookies. When your server needs the private result, use `assess()` instead:

```ts
const result = await visitor.assess(request);

if (result.identity) {
  // Private to this server; do not include these in the browser response.
  const { confidence, risk, riskStatus } = result.identity;
  // Pass them to your own policy or server analytics here.
}

return result.response;
```

With AI disabled, `riskStatus` is `"disabled"`. The zero risk values mean “not assessed,” not “safe.” Doorman does not block anyone or show a CAPTCHA.

## Next: connect your application

Follow [add Doorman to your app](IDENTITY-CONTEXT.md) to connect your existing login and analytics. Or choose a working example for [Next.js](../examples/nextjs/README.md), [Node/Fastify](../examples/node-fastify/README.md) or [Phoenix](../examples/phoenix/README.md).

You can add [Jev scoring](JEV.md), [PostHog or Mixpanel](ANALYTICS.md), and [extra detection signals](EXPERIMENTAL-DETECTION.md) independently. None is required to remember a browser.

### If something fails

| Symptom                                      | Check                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 503 with “Configure DOORMAN_IDENTITY_SECRET” | Create `.dev.vars` in `examples/cloudflare-worker`, then restart the server.                                                    |
| Database error                               | Check the database binding and file permissions. Table setup is automatic; no migration command is needed.                      |
| Import or missing export error               | Run `pnpm install` and `pnpm build` at the repository root. Use the checkout's workspace packages while publication is pending. |
| Every visit has a new ID                     | Check that cookies are allowed and that the request uses the same origin as the page.                                           |

Stop the development server with Ctrl-C. Its local database remains available for your next run.
