# Connect analytics

Doorman sends identity context to your existing analytics project. Your application supplies the authenticated person or agent ID. People and agents remain separate profiles, even when they use the same account.

```elixir
Doorman.Analytics.capture(:amplitude, identity, current_actor.id,
  api_key: System.fetch_env!("AMPLITUDE_API_KEY"),
  account_id: current_account.id
)

Doorman.Analytics.capture(:rudderstack, identity, current_actor.id,
  host: System.fetch_env!("RUDDERSTACK_DATA_PLANE_URL"),
  write_key: System.fetch_env!("RUDDERSTACK_WRITE_KEY"),
  account_id: current_account.id
)
```

PostHog uses `:posthog` and `api_key:`. Mixpanel uses `:mixpanel` and `token:`. Set `host:` for the appropriate regional ingestion endpoint. Amplitude's default minimum user ID length is five characters. Keep one stable ID namespace across your browser and server integrations.

## Update a profile

```elixir
Doorman.Analytics.identify_user(:amplitude, current_user.id,
  %{"name" => current_user.name, "plan" => "pro"},
  api_key: System.fetch_env!("AMPLITUDE_API_KEY")
)
```

Only `name`, `email` and `plan` are accepted as profile traits. Including email is optional. Risk and API activity summaries belong in the private server event, not a browser-readable profile. If the provider is unavailable the export returns `{:error, :unavailable}` without interrupting the application.

## Browser lifecycle

Your frontend still uses the shared JavaScript client to manage anonymous journeys, login and logout in initialized provider SDKs. It supports PostHog, Mixpanel, Segment, Amplitude and RudderStack. Server exports do not rotate browser SDK IDs: call `doorman.reset()` on logout. Do not send duplicate server events both directly and through a connected RudderStack destination.

## Account reports and warehouses

Group by `doorman_account_id`, count distinct verified `doorman_actor_id`, and break down by `doorman_actor_kind`. Never count events or browser IDs as people. API activity fields are prefixed `doorman_api_`; missing risk remains unavailable rather than being treated as evidence of safety.

RudderStack can route these same events to Snowflake or BigQuery. Or use `Doorman.Warehouse` to write versioned JSONL to a customer-owned sink. [Warehouse setup](../../../docs/WAREHOUSES.md).
