# Elixir API

Create one configuration with `Janitor.new/1`. It connects your Ecto repo, identity namespace and optional Jev evaluator. The library runs inside your Phoenix application.

```elixir
janitor = Janitor.new(
  repo: MyApp.Repo,
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  identity: [secret: System.fetch_env!("JANITOR_IDENTITY_SECRET"), namespace: "my-app"]
)
```

Use `Janitor.Plug` for the browser endpoint. Results in `conn.assigns.janitor_identity` are private server data; the response exposes the visitor ID and returning status. Your login system supplies authenticated person and agent identities. Browser matching never authenticates a user.

## API behavior

`Janitor.ActivityPlug` records allowlisted route aggregates. `Janitor.Activity.assess/2` evaluates previously completed activity before a sensitive operation; `observe/3` records an outcome. [Configure activity](../../../docs/API-ACTIVITY.md).

## Analytics

`Janitor.Analytics.capture/4` sends private summary properties to PostHog, Mixpanel, Amplitude or RudderStack. `identify_user/4` updates allowlisted profile traits. `Janitor.Warehouse.event/3` and `encode/1` prepare a JSONL row for your own pipeline. [Connect analytics](../../../docs/ANALYTICS.md).

## Storage and deletion

`Janitor.Migration.up/0` installs the schema. Existing installations apply the incremental upgrade functions before enabling features. `Janitor.cleanup/1` performs bounded maintenance. See the [complete native package reference](../../../packages/elixir/README.md) for identity, delegation, learning, evidence and lifecycle APIs.
