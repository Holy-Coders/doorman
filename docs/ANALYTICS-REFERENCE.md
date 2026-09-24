# Analytics exporters and report recipes

Start with [connect your analytics](ANALYTICS.md). This reference covers optional server exporters, lower-level identity helpers and report recipes. The recommended `assess()` flow already provides private event properties; you do not need these extra helpers for ordinary login tracking.

## Send server events from Phoenix

Serve `/doorman/doorman.js` using the [native setup](../packages/elixir/README.md). Configure only the providers you use:

```elixir
Doorman.new(
  repo: MyApp.Repo,
  secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
  namespace: "my-app",
  analytics: [
    posthog: [api_key: System.fetch_env!("POSTHOG_API_KEY")],
    mixpanel: [token: System.fetch_env!("MIXPANEL_TOKEN")]
  ]
)
```

Your controller receives identity and account membership from authentication/authorization plugs, not measurement JSON. Here the authenticated person is also the principal; delegated users/agents must instead supply their separately verified actor and delegation as in the [identity guide](AGENTIC-IDENTITY.md).

```elixir
# Existing :browser pipeline includes fetch_session and protect_from_forgery.
post "/api/visitor", VisitorController, :identify

# Controller; config() returns the reusable configuration above.
def identify(conn, _params) do
  c = config()
  context = case conn.assigns[:current_user] do
    nil -> %{}
    user ->
      %{
        auth: %{user_id: to_string(user.id), account_id: to_string(conn.assigns.current_account.id)},
        analytics_consent: conn.assigns[:analytics_allowed] == true,
        analytics_id: to_string(user.id),
        analytics_context: %{account_id: to_string(conn.assigns.current_account.id)}
      }
  end
  Doorman.handle(conn, c, context)
end
```

`current_account` must be the account the server authorized for this request. For an application with no workspace/account concept, omit `analytics_context`. The authenticated actor's stable application ID must match the browser SDK's distinct ID. An agent gets its own stable ID (for example `agent:123`), never its owner's distinct ID. Unknown operators must not be reported under the owner's ID merely because a browser matches. `analytics_consent` is a server-owned collection-policy decision; it does not require a Doorman consent dialog.

The browser receives only `visitorId`, `sessionId` and `isReturning`. Full private results are in `conn.assigns.doorman_identity` and `conn.assigns.doorman_evidence`. Provider delivery is best effort and bounded to 750 ms/provider by default; it does not change identity. The configured automatic exports are synchronous on the measurement request, so use existing server SDK buffering/application delivery infrastructure at high volume instead of paying two export waits per measurement. Nothing new runs on every LiveView render or WebSocket message.

For explicit server exports or profile updates:

```elixir
# Existing authenticated actor and server-owned assessment:
Doorman.Analytics.capture(:mixpanel, identity, to_string(actor.id),
  token: System.fetch_env!("MIXPANEL_TOKEN"),
  account_id: to_string(account.id)
)
Doorman.Analytics.identify_user(:mixpanel, to_string(user.id),
  %{"email" => user.email, "name" => user.name, "plan" => "pro"},
  token: System.fetch_env!("MIXPANEL_TOKEN")
)
# Same calls with :posthog and api_key: ...
# Existing SDK: Doorman.Analytics.properties(identity, %{account_id: to_string(account.id)})
```

Only pass profile values the application is allowed to disclose. Verified email keys in Doorman's identity directory are a separate HMAC-based lookup feature; changing an email must not change the analytics person's ID. Account updates and analytics work with learning disabled.

## Send server events from TypeScript

The bridge adds no provider dependency. Supply an existing `posthog-node`, `mixpanel`, or `@segment/analytics-node` client:

```ts
import { createAnalyticsBridge } from "@aarondovturkel/doorman-adapters/analytics";
const analytics = createAnalyticsBridge({
  provider: "mixpanel",
  client: mixpanelServer,
});
await analytics.identifyUser(authenticatedActor.id, { plan: "pro" });
await analytics.capture(privateIdentity, authenticatedActor.id, {
  accountId: authorizedAccount.id,
});
// Or use analyticsProperties(privateIdentity, { accountId }) with your existing SDK.
```

PostHog uses `provider: "posthog"`; Segment uses `provider: "segment"`. Keep risk export on the server. The server bridge returns `queued` or `unavailable`; callback-based SDK failures may arrive later. Configure provider error handlers and flush/shutdown at the relevant application lifecycle boundary. Native Elixir exports use bounded real HTTP and report `:ok` on accepted ingestion, not dashboard verification.

Mixpanel server events send both `distinct_id` and `$user_id` for Simplified ID Merge. Projects using Original ID Merge can select `identityMerge: "original"` or native `identity_merge: :original`. Check the existing project's identity mode before rollout; the bridge does not change it. Browser SDKs retain control of their anonymous/device IDs. No server merge uses a fuzzy-restored Doorman visitor ID.

### Agents without a browser

After verifying an agent credential and its delegation, export the directory assessment directly. No browser collection, synthetic visitor ID or manufactured zero risk is needed:

```elixir
attribution = Doorman.Identity.assess(config, verified_context)
Doorman.Analytics.capture(:mixpanel, %{"attribution" => attribution}, "agent:123",
  token: System.fetch_env!("MIXPANEL_TOKEN"), account_id: to_string(account.id))
```

```ts
const attribution = await visitor.identities!.assess(verifiedContext);
await analytics.capture({ attribution }, "agent:123", {
  accountId: account.id,
});
```

These use the same event and actor dimensions; browser/risk fields are absent. Missing risk remains unmeasured. Resolve `verified_context` from authenticated credentials and server-owned authorization, never from an agent's self-description.

## Understand the exported fields

The server event remains `doorman identified`. Its event properties describe the assessment at that moment; they are not persistent account membership or a permanent fraud label.

| Property                                                          | Meaning                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `doorman_schema_version`                                          | `1` for this export schema                                                        |
| `doorman_account_id`                                              | Optional application account/workspace, supplied by the authorized server         |
| `doorman_subject_id`, `doorman_subject_status`                    | Verified principal being represented; opaque Doorman directory ID                 |
| `doorman_actor_id`                                                | Opaque directory ID of the separately authenticated operator; absent when unknown |
| `doorman_actor_kind`, `doorman_actor_basis`                       | `person`, `agent`, or `unknown`; verified credential basis or unknown             |
| `doorman_visitor_id`                                              | Browser continuity ID; can relate to multiple actors                              |
| `doorman_confidence`, `doorman_returning`                         | Browser matching evidence, not human/account authentication probability           |
| `doorman_automation`, `doorman_suspicious`, `doorman_risk_status` | Technical risk and whether it was evaluated, unavailable or disabled              |
| `doorman_delegation_status`                                       | `none`, `valid`, or `invalid` when assessed                                       |

There is no raw fingerprint, behavior summary, debug record, IP, secret, email key or anonymous learning prediction in these events. Actor/subject fields come from the private credential assessment. Low automation never turns an unknown actor into a verified person. Stable actor IDs allow distinct counting without merging users who share a browser/account. Use the same actor ID conventions throughout the application; prefix separately managed agent IDs to prevent collisions with human IDs.

Actor counting starts when events contain these new fields; older exports cannot retroactively supply missing actor IDs. Analytics is a reporting system, not the source of authentication or membership. Projects that accept events using public browser tokens can receive fabricated events, so reports alone must never grant access or serve as an authoritative security audit.

## Count people and agents per account

These examples count identities whose credentials your app verified. They cannot count different physical people who all share the same login.

| Question                                                                   | Aggregation and filter                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| How many humans used account X this month?                                 | Distinct `doorman_actor_id`; account X, kind `person`, basis `verified-credential`, chosen time window |
| How many agents used it?                                                   | Same, kind `agent`; filter valid delegation when asking about delegated agents                         |
| Has one browser been used by multiple people?                              | Distinct actor IDs grouped by visitor ID; verified persons only; count > 1                             |
| How many browsers did a person use?                                        | Distinct visitor IDs for one actor; these are browser environments, not guaranteed physical devices    |
| What activity came from unknown operators?                                 | Event count where actor basis is `unknown`; do not turn that into a number of people                   |
| How many members/agents are authorized right now, including inactive ones? | Your current membership/delegation database, not historical analytics events                           |

These reports count **observed active actors**, not everyone registered. An invalid delegation can still describe an observed authenticated agent, so explicitly require `doorman_delegation_status = valid` when counting observed authorized delegations. Historical events remain historical after revocation. No report can count distinct physical humans sharing one undifferentiated credential. Browser-cookie copying and probabilistic recovery also mean a shared visitor ID is evidence to investigate, not proof that people share a physical device.

### Mixpanel report setup

In Insights, select `doorman identified`, filter `doorman_account_id = your-account` and `doorman_actor_basis = verified-credential`, then measure **Distinct count of property → doorman_actor_id**. Break down by `doorman_actor_kind`. Use the total over your chosen date range; adding daily unique counts double-counts returning actors. For shared-browser analysis, filter kind `person` and break down by `doorman_visitor_id` instead. These reports use event properties and do not require enabling Group Analytics. [Mixpanel distinct-property measurements](https://docs.mixpanel.com/docs/reports/insights).

If you already use provider account/group analytics, opt into `accountGroup: "account"` on the TypeScript bridge or `account_group: "account"` in native provider options. Doorman attaches each event to that account: PostHog `groups`/`$groups`, Mixpanel the configured group-key property. Earlier events retain their original account when a user switches workspaces. The plain `doorman_account_id` field remains available either way. Group support must already be enabled/configured in your project; Doorman does not purchase an add-on or create/change group definitions. [PostHog groups](https://github.com/PostHog/posthog.com/blob/master/contents/docs/product-analytics/group-analytics.mdx), [Mixpanel groups](https://docs.mixpanel.com/docs/data-structure/group-analytics).

### PostHog SQL recipes

Copy into PostHog SQL and replace the example account literal with your selected account. These recipes are supplied for your project; they have not been executed against a live analytics project.

```sql
SELECT properties.doorman_actor_kind AS actor_kind,
       uniqExact(properties.doorman_actor_id) AS observed_actors
FROM events
WHERE event = 'doorman identified'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.doorman_account_id = 'account-example'
  AND properties.doorman_actor_basis = 'verified-credential'
  AND properties.doorman_actor_id IS NOT NULL
GROUP BY actor_kind
```

```sql
SELECT properties.doorman_visitor_id AS browser_id,
       uniqExact(properties.doorman_actor_id) AS verified_people
FROM events
WHERE event = 'doorman identified'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.doorman_account_id = 'account-example'
  AND properties.doorman_actor_kind = 'person'
  AND properties.doorman_actor_basis = 'verified-credential'
  AND properties.doorman_actor_id IS NOT NULL
  AND properties.doorman_visitor_id IS NOT NULL
GROUP BY browser_id
HAVING verified_people > 1
ORDER BY verified_people DESC
```

PostHog documents [`uniqExact` and conditional aggregates](https://github.com/PostHog/posthog.com/blob/master/contents/docs/sql/aggregations.mdx). Scope reports to the intended account, time window and identity namespace. Rotating the directory secret changes opaque actor IDs and can split historical counts; plan that migration explicitly.

### Questions for your analytics assistant

Once events are ingested, give the provider's assistant this metric definition along with your question:

> Use the `doorman identified` event. For account `account-example` over the last 30 days, count distinct `doorman_actor_id`, filtering `doorman_actor_basis = verified-credential`, and break down by `doorman_actor_kind`. Separately show observed agents with valid delegation. Do not count visitors as people, unknown operators as humans, or events as users. Show the report/query and time window used.

> For that account and date range, which `doorman_visitor_id` values had more than one distinct verified person? Report the count and IDs without merging their profiles. Describe these as browser-continuity associations, not proof of shared hardware or account compromise.

The library prepares the event schema; it does not add an AI query agent or a new dashboard. These prompts require the analytics product's query/assistant capability and your access permissions. Do not feed browser scores into a frontend AI assistant; use authorized access to the server-ingested analytics dataset.

## Check the integration in a development project

Connect one provider first, then the other if needed. In a development project, verify: anonymous visit → login → second device login to the same user → logout → different user on the original browser → delegated agent with its own ID. Confirm one profile per actor, two profiles for two people sharing a browser, the intended account on every event, and no private scores in browser requests. Check rejected/late events and regional ingestion hosts. Analytics deletion and consent withdrawal must follow your provider's own lifecycle as well as Doorman erasure.

The repository tests the actual installed PostHog and Mixpanel browser SDKs with all analytics requests intercepted locally, and native HTTP payloads with mocked transports. The tests do not verify live provider profile merging or dashboard counts. Transport acceptance does not establish a report's accuracy; review ingestion and distinct-count results in your own project before using them operationally.

## Amplitude and RudderStack

Doorman also supports initialized Amplitude Browser SDK 2 and RudderStack JavaScript SDKs:

```ts
const doorman = createDoormanClient({
  analytics: { amplitude, rudderstack },
});
await doorman.identify(currentUser.id, { plan: "pro" });
// Forwards to both configured SDKs. Do not also track this event directly.
await doorman.track("project opened");
await doorman.reset();
```

**Send each event once to each destination.** `doorman.track()` is an optional forwarding helper, not an extra call to add alongside native SDK tracking. For Amplitude and RudderStack, the helper also attaches Doorman context; their direct SDK calls are not automatically enriched. For PostHog and Mixpanel, existing direct calls can keep receiving the context registered by Doorman. See [the tracking options](ANALYTICS.md).

Import `createDoormanClient` from `@aarondovturkel/doorman-browser`. Configure consent, region, autocapture and destinations in your provider's initialization first; Doorman does not load or enable those SDKs. Amplitude uses `setUserId`, the documented `$identify` event with `$set` traits, and `reset` to rotate its device ID. RudderStack explicitly rotates its anonymous ID and clears custom context on account changes and logout. Destination SDKs loaded independently still need their own reset lifecycle. These behaviors follow [Amplitude's browser contract](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2), [HTTP V2](https://amplitude.com/docs/apis/analytics/http-v2), and [RudderStack's reset contract](https://www.rudderstack.com/docs/sources/event-streams/sdks/rudderstack-javascript-sdk/supported-api/).

The server bridge accepts `provider: "amplitude"` with the initialized `@amplitude/analytics-node` client, or `provider: "rudderstack"` with `@rudderstack/rudder-sdk-node`. The same `capture`, `identifyUser` and account context apply. Amplitude supports an optional configured `accountGroup`; group features depend on the customer's project. Use stable user IDs of at least five characters or explicitly configure Amplitude's `minIdLength` in the SDK. `queued` does not guarantee downstream ingestion. Flush the provider SDK during server shutdown.

```ts
const bridge = createAnalyticsBridge({
  provider: "amplitude",
  client: amplitude,
});
await bridge.capture(identity, authenticatedActor.id, {
  accountId: account.id,
});
```

Elixir has explicit `:amplitude` and `:rudderstack` HTTP exports too. Amplitude accepts `api_key:` and an optional regional `host:`. RudderStack requires `write_key:` and your HTTPS data-plane `host:`. The library follows the documented HTTP examples using Basic authentication with `write_key:` as the username and an empty password. No browser fingerprint or raw IP is sent.

Prefer RudderStack when you already route events into several tools or a warehouse. Prefer Amplitude's direct bridge when it is the destination you use. Avoid sending the same event both ways to the same destination. See [Snowflake and warehouse setup](WAREHOUSES.md) for customer-owned delivery and the portable JSONL exporter.
