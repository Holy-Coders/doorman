# Run the Phoenix example

This is a small Phoenix application with a page, a visitor endpoint and a Postgres database. Doorman runs inside the Elixir application. Use it to see the full flow before following the [installation guide for an existing Phoenix app](../../packages/elixir/README.md).

## Start the app

You need Elixir 1.17+, compatible Erlang/OTP and Postgres. This example uses the 0.13 package from the source checkout. The example can use Docker for a disposable local Postgres instance. From the repository root:

```sh
# Skip this command if you already have a local Postgres database.
docker run --name doorman-example-pg -e POSTGRES_USER=visitor -e POSTGRES_PASSWORD=visitor -e POSTGRES_DB=visitors -p 127.0.0.1:55433:5432 -d postgres:17-alpine
cd examples/phoenix
export DATABASE_URL=postgres://visitor:visitor@localhost:55433/visitors
mix setup
mix phx.server
```

Open **http://localhost:4000** and select **Identify** twice. The second call should reuse the cookie and keep the same visitor ID. Set `PORT=4001` if you need another port.

Doorman creates its tables automatically on first use. There are no Doorman migration commands. The package already includes its browser JavaScript, so running the example does not require pnpm. After changing that browser code in the monorepo, contributors regenerate it with `pnpm protocol:sync`.

## What is enabled

Jev is off unless you set `JEV_API_KEY`. Enabling it makes provider calls that can incur charges. No PostHog or Mixpanel export is configured in this example; the [analytics guide](../../docs/ANALYTICS.md) shows how to connect your existing setup.

The demo enables application-wide [learning-session collection](../../docs/LEARNING.md) but supplies no authenticated user labels. This is an optional demonstration setting, not a requirement for browser recognition. Choose the appropriate collection policy when adding Doorman to your app.

## Try the optional API Plug

Start the app with `DOORMAN_API_ACTIVITY=1 mix phx.server`. Then make two requests with the same application session:

```sh
curl -c /tmp/doorman-example.cookies -b /tmp/doorman-example.cookies http://localhost:4000/api/example/orders/123
curl -c /tmp/doorman-example.cookies -b /tmp/doorman-example.cookies http://localhost:4000/api/example/orders/456
```

Both responses contain only example order JSON. The Plug records two operations for `GET /api/example/orders/:id` under the same application-issued session key; it does not store either order ID. Its result remains in `conn.assigns.doorman_api_activity`. No actor identity is manufactured for this anonymous demo session. Keep `JEV_API_KEY` unset to test without paid inference.

Follow [API activity](../../docs/API-ACTIVITY.md) to mount the Plug after your real authentication, provide verified agent context, use the existing analytics bridge, or erase activity.

## Adapt it for production

The local example binds to loopback and permits a non-Secure cookie on localhost. Production needs HTTPS, strong `SECRET_KEY_BASE` and `DOORMAN_IDENTITY_SECRET` values, suitable database TLS/pool settings, and `Doorman.new(environment: :production, secure_cookie: true, ...)`.

Keep the existing Phoenix session and CSRF boundary. The browser response contains only `visitorId`, `sessionId` and `isReturning`; private results are available to server code. See [the native setup](../../packages/elixir/README.md) for controller code, cleanup, account updates and LiveView lifecycle.

## Run the example test

With the database available, run `mix test`. It checks the page, packaged client and rejection of a request without the required CSRF token. It does not call Jev or send analytics events.
