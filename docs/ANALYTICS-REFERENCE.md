# Analytics report recipes

Start with [connect your analytics](ANALYTICS.md). Doorman returns context; PostHog, Mixpanel and your other tools store events and build reports. You do not need a second analytics pipeline or a separate Doorman identity directory.

## Attach context to a server event

The normal TypeScript `assess()` result already includes flat properties. Use your existing initialized server SDK, once per event:

```ts
const result = await doorman.assess(request, {
  auth: { userId: currentUser.id, accountId: currentAccount.id },
});
if (result.response.ok && result.properties) {
  posthog.capture({
    distinctId: currentUser.id,
    event: "identity assessed",
    properties: {
      ...result.properties,
      doorman_account_id: String(currentAccount.id),
    },
  });
}
return result.response;
```

`posthog` is your server SDK, and the user/account come from verified application state. Omit account context without workspaces. Your SDK owns delivery, error handling and flushing. Use a separately authenticated agent's own analytics ID for its events, never its owner's ID. Anonymous events keep your existing anonymous identity.

The application-owned `doorman_account_id` above makes reporting with your familiar workspace ID straightforward. Doorman's separate `doorman_context_account_id` is a namespace-scoped, opaque relationship label; do not assume the two strings are interchangeable.

In Phoenix, `Doorman.handle(conn, config, %{auth: auth})` returns a halted connection with private `conn.assigns.doorman_properties`. Attach those properties, plus your authorized account ID, to your existing server event. It has already sent the measurement response; business-action events belong in their own handlers.

Neither browser tracking nor server context automatically creates cohorts, dashboards, session recordings, application logs or error traces. Configure those in your analytics/observability tools. Context makes their events easier to join and filter.

## Optional provider helpers

If you do not already have server delivery code, the package also includes explicit provider exporters:

```ts
import { createAnalyticsBridge } from "@aarondovturkel/doorman-adapters/analytics";

const bridge = createAnalyticsBridge({
  provider: "mixpanel",
  client: mixpanelServer,
});
await bridge.capture(result.identity, authenticatedActor.id, {
  accountId: authorizedAccount.id,
});
```

Call this only when `result.identity` exists. It exports the identity/risk summary; use the full `result.properties` snapshot with your SDK when you want remembered/inferred context and operator fields too. Do not send the same event by both paths. Native Elixir has corresponding `Doorman.Analytics` exporters. No helper replaces verification of the actor or account.

Agents calling only your API can be reported through your existing authenticated server events, with their stable agent ID and account membership. [API activity](API-ACTIVITY.md) adds optional aggregate risk evidence. There is no need to invent a browser ID for an API-only caller.

## Understand the exported fields

The server event remains `identity assessed`. Its event properties describe the assessment at that moment; they are not persistent account membership or a permanent fraud label.

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
| `doorman_identity_status`, `doorman_identity_basis`               | Separate authenticated, remembered and inferred context.                          |
| `doorman_operator_label`, `doorman_operator_status`               | Experimental activity classification and availability.                            |

There is no raw fingerprint, behavior summary, debug record, IP, secret or email key in these properties. The private `result.properties` snapshot can include a tentative candidate ID and score; keep those separate from verified subject/actor IDs. Actor/subject fields come from the private credential assessment. Low automation never turns an unknown actor into a verified person. Stable actor IDs allow distinct counting without merging users who share a browser/account. Use the same actor ID conventions throughout the application; prefix separately managed agent IDs to prevent collisions with human IDs.

Actor counting starts when events contain these new fields; older exports cannot retroactively supply missing actor IDs. Analytics is a reporting system, not the source of authentication or membership. Projects that accept events using public browser tokens can receive fabricated events, so reports alone must never grant access or serve as an authoritative security audit.

## Count people and agents per account

These examples count identities whose credentials your app verified. They cannot count different physical people who all share the same login.

| Question                                                                   | Aggregation and filter                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| How many humans used account X this month?                                 | Distinct `doorman_actor_id`; account X, kind `person`, basis `verified-credential`, chosen time window |
| How many agents used it?                                                   | Same, kind `agent`; your server must have authorized that actor                                        |
| Has one browser been used by multiple people?                              | Distinct actor IDs grouped by visitor ID; verified persons only; count > 1                             |
| How many browsers did a person use?                                        | Distinct visitor IDs for one actor; these are browser environments, not guaranteed physical devices    |
| What activity came from unknown operators?                                 | Event count where actor basis is `unknown`; do not turn that into a number of people                   |
| How many members/agents are authorized right now, including inactive ones? | Your current membership/delegation database, not historical analytics events                           |

These reports count **observed active actors**, not everyone registered. Your server must verify agent permission before supplying `auth.actor`; Doorman does not run an authorization service for the recommended flow. Historical events remain historical after revocation. No report can count distinct physical humans sharing one undifferentiated credential. Browser-cookie copying and probabilistic recovery also mean a shared visitor ID is evidence to investigate, not proof that people share a physical device.

### Mixpanel report setup

In Insights, select `identity assessed`, filter `doorman_account_id = your-account` and `doorman_actor_basis = verified-credential`, then measure **Distinct count of property → doorman_actor_id**. Break down by `doorman_actor_kind`. Use the total over your chosen date range; adding daily unique counts double-counts returning actors. For shared-browser analysis, filter kind `person` and break down by `doorman_visitor_id` instead. These reports use event properties and do not require enabling Group Analytics. [Mixpanel distinct-property measurements](https://docs.mixpanel.com/docs/reports/insights).

If you already use provider account/group analytics, opt into `accountGroup: "account"` on the TypeScript bridge or `account_group: "account"` in native provider options. Doorman attaches each event to that account: PostHog `groups`/`$groups`, Mixpanel the configured group-key property. Earlier events retain their original account when a user switches workspaces. The plain `doorman_account_id` field remains available either way. Group support must already be enabled/configured in your project; Doorman does not purchase an add-on or create/change group definitions. [PostHog groups](https://github.com/PostHog/posthog.com/blob/master/contents/docs/product-analytics/group-analytics.mdx), [Mixpanel groups](https://docs.mixpanel.com/docs/data-structure/group-analytics).

### PostHog SQL recipes

Copy into PostHog SQL and replace the example account literal with your selected account. These recipes are supplied for your project; they have not been executed against a live analytics project.

```sql
SELECT properties.doorman_actor_kind AS actor_kind,
       uniqExact(properties.doorman_actor_id) AS observed_actors
FROM events
WHERE event = 'identity assessed'
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
WHERE event = 'identity assessed'
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

> Use the `identity assessed` event. For account `account-example` over the last 30 days, count distinct `doorman_actor_id`, filtering `doorman_actor_basis = verified-credential`, and break down by `doorman_actor_kind`. Separately show observed agents with valid delegation. Do not count visitors as people, unknown operators as humans, or events as users. Show the report/query and time window used.

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
