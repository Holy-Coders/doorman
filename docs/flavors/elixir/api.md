# Elixir API

Create one configuration with `Doorman.new/1`. It connects your Ecto repo, identity namespace and optional Jev evaluator. The library runs inside your Phoenix application.

```elixir
doorman = Doorman.new(
  repo: MyApp.Repo,
  secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
  namespace: "my-app"
)
```

Use `Doorman.Plug` for the browser endpoint. Results in `conn.assigns.doorman_identity` are private server data; the response exposes the `visitorId`, `sessionId` and `isReturning`. Your login system supplies authenticated person and agent identities. Browser matching never authenticates a user.

## API behavior

`Doorman.ActivityPlug` records allowlisted route aggregates. `Doorman.Activity.assess/2` evaluates previously completed activity before a sensitive operation; `observe/3` records an outcome. [Configure activity](../../API-ACTIVITY.md).

## Analytics

`Doorman.Analytics.capture/4` sends private summary properties to PostHog, Mixpanel, Amplitude or RudderStack. `identify_user/4` updates allowlisted profile traits. `Doorman.Warehouse.event/3` and `encode/1` prepare a JSONL row for your own pipeline. [Connect analytics](../../ANALYTICS.md).

## Storage and deletion

Doorman creates its tables automatically. `Doorman.ready/1` optionally prepares them during application startup. `Doorman.cleanup/1` performs bounded maintenance. See the [complete native package reference](../../../packages/elixir/README.md) for endpoint setup, authenticated context, scoring and deletion.
