# Doorman for Elixir and Phoenix

Add browser identity and account context to your Phoenix application using your existing Ecto Postgres repo. Doorman runs natively in Elixir and includes the browser client. No Node service or manual migrations are needed.

This guide covers the upcoming 0.13 release. You can [run the source example](../../examples/phoenix/README.md) now, while package publication finishes.

## 1. Install

After publication, add this to `deps` in `mix.exs`:

```elixir
{:doorman_identity, "~> 0.13.0"}
```

Until then, clone the repository beside your app and use `{:doorman_identity, path: "../doorman/packages/elixir"}`. Run `mix deps.get`. Requires Elixir 1.17+, Ecto SQL 3.14+, Plug and Postgres.

Generate a secret with `openssl rand -hex 32` and store it as `DOORMAN_IDENTITY_SECRET` in your server environment. Keep the same value across restarts and app instances.

## 2. Add an endpoint

Add this route inside your existing `:browser` pipeline, with session fetching and CSRF protection:

```elixir
post "/api/visitor", VisitorController, :identify
```

Create the controller:

```elixir
defmodule MyAppWeb.VisitorController do
  use MyAppWeb, :controller

  def identify(conn, _params) do
    config = Doorman.new(
      repo: MyApp.Repo,
      secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
      namespace: "my-app"
    )

    auth = case conn.assigns[:current_user] do
      nil -> nil
      user -> %{user_id: to_string(user.id)}
    end

    Doorman.handle(conn, config, %{auth: auth})
  end
end
```

Replace `MyApp` with your application. `current_user` must come from your existing authentication plug; use your app's assign name if different. Anonymous requests pass `nil`. Add `account_id` only after your server has authorized that workspace.

On first use, Doorman creates its tables in a dedicated `doorman` schema. The repo connection needs permission to create that schema, its tables and indexes. Successful setup is cached for the running Repo; concurrent starts are protected by a database lock. Optionally call `Doorman.ready(config)` after your Repo starts to prepare tables before serving traffic.

## 3. Serve the browser module

Add this `Plug.Static` before your router in `endpoint.ex`:

```elixir
plug Plug.Static,
  at: "/doorman",
  from: {:doorman_identity, "priv/static"},
  only: ~w(doorman.js)
```

Keep Phoenix's CSRF meta tag in your root layout. In browser JavaScript:

```js
import { createDoormanClient } from "/doorman/doorman.js";

const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  headers: () => ({
    "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content,
  }),
});

const identity = await doorman.identify();
// { visitorId, sessionId, isReturning }
```

The first visit creates a browser ID; later calls reuse its cookie. Create the client only when your collection policy allows it. In LiveView, a hook can create it in `mounted()` and call `doorman.destroy()` in `destroyed()`. A new mount needs a new client. For analytics across LiveView navigation, keep one client in your application bootstrap instead of recreating it in every hook.

## 4. Connect analytics

Pass your already initialized SDKs as `analytics: { posthog, mixpanel }`. Call `doorman.identify({ userId: String(user.id) })` after login and when loading an already signed-in session. Call `doorman.reset()` after logout or session expiry. Doorman handles provider identification; you do not need to call both SDKs yourself.

Browser identification does not authenticate the user to the endpoint: the controller's `auth` context does that. See [the analytics lifecycle](../../docs/ANALYTICS.md) for account switching, profile updates and error handling.

## Read private results

`Doorman.handle` sends the public response and returns a halted connection. Server results are available in:

- `conn.assigns.doorman_context`: verified, remembered or tentative identity relationships.
- `conn.assigns.doorman_identity`: browser identity and private risk scores.
- `conn.assigns.doorman_properties`: flat properties for a server analytics event.

Only `{ visitorId, sessionId, isReturning }` goes to the browser. Remembered context never grants access or identifies an anonymous visitor as a known person in analytics.

## Add optional scoring

Add `evaluator: [api_key: System.fetch_env!("JEV_API_KEY")]` to `Doorman.new` to enable Jev. Provider charges may apply. Without it, `riskStatus` is `"disabled"`; failed evaluation is `"unavailable"`. Zero risk in either case means “not assessed.”

Add `cross_device: true` to learn tentative connections from later verified logins. Add `collection: "extended"` to the browser client for bounded additional signals. [The context guide](../../docs/flavors/elixir/identity-context.md) explains the results and limits.

For a separately authenticated agent acting for a user, pass `actor: %{id: agent_id, kind: :agent}` in `auth`. Your app must verify the credential and permission. Browser patterns cannot prove how many people share a password.

## Maintain and deploy

Production needs HTTPS, secure cookies and the stable secret. The runnable local example explicitly relaxes cookies on loopback; do not copy that exception to production.

Use an existing maintenance task:

```elixir
Doorman.cleanup(config)
Doorman.forget_user(config, raw_user_id)
Doorman.delete_visitor(config, visitor_id)
```

These are separate operations: cleanup expires old history; the other two erase a user or browser after your app authorizes deletion. Also erase copies sent to analytics.

The defaults are 90 days of observations, ten stored observations per browser and five loaded for matching. Set `observation_retention_days` or `max_observations_per_visitor` to change them. Use a separate schema/database per application. [Storage and retention](../../site/content/storage.md) covers restricted database users and startup checks.
