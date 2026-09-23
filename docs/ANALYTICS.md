# Identify people, accounts and agents in analytics

Janitor enriches your existing PostHog or Mixpanel setup. A visitor is a browser environment; a person or agent is an actor; an account/workspace is the context they are using. Keep these IDs separate. One browser can have several verified users, one user can have several browsers, and one account can have several people and agents.

**The lifecycle helper and account/actor export fields below are unreleased checkout additions.** They are available through local/workspace dependencies, including the bundled Phoenix client after `pnpm protocol:sync`, not the v0.6.0 tag or published registries. No provider events or project changes are enabled automatically.

## What the user experiences

The normal visit, signup and login screens stay the same. A background measurement runs when your application permits collection. It does not hold up rendering or authentication, show a score, or present a CAPTCHA. Authenticated users retain their existing profile across devices. On logout, analytics starts a fresh anonymous identity for whoever uses that browser next.

A shared family browser can therefore show two verified users in analytics without merging their profiles. Two humans using the same credential remain one authenticated actor: browser differences alone cannot establish how many physical people are present. Janitor can report uncertainty and risk, not secretly authenticate the operator.

If the application decides a sensitive operation requires extra verification, its normal passkey/MFA/CAPTCHA flow appears there. The server verifies that proof. Janitor never selects or renders that UI.

## Browser integration: initialize once, then hook authentication

Use the PostHog/Mixpanel instances your application already initializes. Do not install a second instance, turn on replay, or change their collection settings to use Janitor. Installing SDKs is only needed if the application does not have them:

```sh
npm install posthog-js mixpanel-browser
# or: bun add posthog-js mixpanel-browser
# or: pnpm add posthog-js mixpanel-browser
```

For Phoenix, the generated client comes from the Mix package; no additional Janitor JavaScript build is required. In an npm/Bun application import the same exports from `@janitor/browser`.

```js
import {
  createVisitorClient,
  createIdentityAnalytics,
} from "/janitor/janitor.js";
// posthog and mixpanel below are your existing initialized browser SDKs.
const visitor = createVisitorClient({
  headers: () => ({
    "x-csrf-token": document.querySelector('meta[name="csrf-token"]').content,
  }),
});
const analytics = createIdentityAnalytics({ visitor, posthog, mixpanel });

function measure() {
  // An unavailable measurement must not break navigation or sign-in.
  void visitor.identify().catch(() => {});
}

// An anonymous page, after your application's collection policy allows it:
measure();

// After successful login/signup, and when restoring an authenticated session:
function authenticated(user) {
  analytics.identifyUser(String(user.id));
  measure(); // Server resolves the now-authenticated session itself.
}

// After the server has logged out or expired the authenticated session:
function loggedOut() {
  analytics.reset();
}
```

Create this bridge once per browser application lifecycle, outside frequently remounted LiveView hooks. Call `authenticated` from your existing auth completion/session bootstrap flow and `loggedOut` on logout, account/session expiry, and relevant cross-tab auth changes. After a full reload the application must still reset a stale identified SDK state if the session has expired. A hook owns any client it creates and calls `visitor.destroy()` on teardown; never reuse a destroyed client.

`identifyUser(id, { name?, email?, plan? })` also supports explicit, allowlisted profile updates. Choose one owner for profile updates, usually the server; do not redundantly update from both places. Repeated identical calls on one bridge return `skipped`. A switch to another user resets each SDK before identification. A failed reset prevents that provider from identifying the new user until a reset succeeds; the other provider proceeds independently. Calls return per-provider `queued`, `skipped`, or `unavailable`. `queued` means the synchronous SDK call completed, not that ingestion was confirmed. Invalid IDs/traits are programming errors and throw before any provider call.

The bridge calls PostHog `identify`, Mixpanel `identify` followed by one `janitor user identified` event, and the providers' own `reset` functions. The extra Mixpanel event completes its Simplified ID Merge transition. No arbitrary alias or visitor ID is used as a person's ID. The helper never receives scores, raw signals or inferred account IDs. It does not load SDKs, enable collection, subscribe to auth, retry requests or manage a server session.

Do not reset provider anonymous IDs immediately before the first successful login: that would discard the link to the current anonymous journey. Janitor's `visitor.reset()` only clears aggregate behavior and stale requests; it does not delete the HttpOnly browser cookie or log out your application. Clear the learning cookie server-side on logout as described in the [Phoenix guide](../packages/elixir/README.md). Collection withdrawal also requires the application's provider opt-out/reset policy; `visitor.setEnabled(false)` pauses only Janitor.

Sources: [PostHog identification semantics](https://github.com/PostHog/posthog.com/blob/master/contents/docs/product-analytics/identify.mdx), [Mixpanel identification and merge](https://docs.mixpanel.com/docs/tracking-methods/id-management/identifying-users-simplified), [Mixpanel profile updates](https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript#storing-user-profiles).

## Phoenix: one private measurement endpoint

Apply Janitor's migration and serve `/janitor/janitor.js` using the [native setup](../packages/elixir/README.md). Configure only the providers you use:

```elixir
Janitor.new(
  repo: MyApp.Repo,
  identity: [secret: System.fetch_env!("JANITOR_IDENTITY_SECRET"), namespace: "my-app"],
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
      person = Janitor.Identity.identify_user(c, to_string(user.id))
      %{
        verified: %{subject_id: person["id"], actor_id: person["id"]},
        analytics_consent: conn.assigns[:analytics_allowed] == true,
        analytics_id: to_string(user.id),
        analytics_context: %{account_id: to_string(conn.assigns.current_account.id)}
      }
  end
  Janitor.handle(conn, c, context)
end
```

`current_account` must be the account the server authorized for this request. For an application with no workspace/account concept, omit `analytics_context`. The authenticated actor's stable application ID must match the browser SDK's distinct ID. An agent gets its own stable ID (for example `agent:123`), never its owner's distinct ID. Unknown operators must not be reported under the owner's ID merely because a browser matches. `analytics_consent` is a server-owned collection-policy decision; it does not require a Janitor consent dialog.

The browser receives only `visitorId` and `isReturning`. Full private results are in `conn.assigns.janitor_identity` and `conn.assigns.janitor_evidence`. Provider delivery is best effort and bounded to 750 ms/provider by default; it does not change identity. The configured automatic exports are synchronous on the measurement request, so use existing server SDK buffering/application delivery infrastructure at high volume instead of paying two export waits per measurement. Nothing new runs on every LiveView render or WebSocket message.

For explicit server exports or profile updates:

```elixir
# Existing authenticated actor and server-owned assessment:
Janitor.Analytics.capture(:mixpanel, identity, to_string(actor.id),
  token: System.fetch_env!("MIXPANEL_TOKEN"),
  account_id: to_string(account.id)
)
Janitor.Analytics.identify_user(:mixpanel, to_string(user.id),
  %{"email" => user.email, "name" => user.name, "plan" => "pro"},
  token: System.fetch_env!("MIXPANEL_TOKEN")
)
# Same calls with :posthog and api_key: ...
# Existing SDK: Janitor.Analytics.properties(identity, %{account_id: to_string(account.id)})
```

Only pass profile values the application is allowed to disclose. Verified email keys in Janitor's identity directory are a separate HMAC-based lookup feature; changing an email must not change the analytics person's ID. Account updates and analytics work with learning disabled.

## TypeScript server integration

The bridge adds no provider dependency. Supply an existing `posthog-node`, `mixpanel`, or `@segment/analytics-node` client:

```ts
import { createAnalyticsBridge } from "@janitor/adapters/analytics";
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

Mixpanel server events send both `distinct_id` and `$user_id` for Simplified ID Merge. Projects using Original ID Merge can select `identityMerge: "original"` or native `identity_merge: :original`. Check the existing project's identity mode before rollout; the bridge does not change it. Browser SDKs retain control of their anonymous/device IDs. No server merge uses a fuzzy-restored Janitor visitor ID.

### Agents without a browser

After verifying an agent credential and its delegation, export the directory assessment directly. No browser collection, synthetic visitor ID or manufactured zero risk is needed:

```elixir
attribution = Janitor.Identity.assess(config, verified_context)
Janitor.Analytics.capture(:mixpanel, %{"attribution" => attribution}, "agent:123",
  token: System.fetch_env!("MIXPANEL_TOKEN"), account_id: to_string(account.id))
```

```ts
const attribution = await visitor.identities!.assess(verifiedContext);
await analytics.capture({ attribution }, "agent:123", {
  accountId: account.id,
});
```

These use the same event and actor dimensions; browser/risk fields are absent. Missing risk remains unmeasured. Resolve `verified_context` from authenticated credentials and server-owned authorization, never from an agent's self-description.

## Data model and reports

The server event remains `janitor identified`. Its event properties describe the assessment at that moment; they are not persistent account membership or a permanent fraud label.

| Property                                                          | Meaning                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `janitor_schema_version`                                          | `1` for this export schema                                                        |
| `janitor_account_id`                                              | Optional application account/workspace, supplied by the authorized server         |
| `janitor_subject_id`, `janitor_subject_status`                    | Verified principal being represented; opaque Janitor directory ID                 |
| `janitor_actor_id`                                                | Opaque directory ID of the separately authenticated operator; absent when unknown |
| `janitor_actor_kind`, `janitor_actor_basis`                       | `person`, `agent`, or `unknown`; verified credential basis or unknown             |
| `janitor_visitor_id`                                              | Browser continuity ID; can relate to multiple actors                              |
| `janitor_confidence`, `janitor_returning`                         | Browser matching evidence, not human/account authentication probability           |
| `janitor_automation`, `janitor_suspicious`, `janitor_risk_status` | Technical risk and whether it was evaluated, unavailable or disabled              |
| `janitor_delegation_status`                                       | `none`, `valid`, or `invalid` when assessed                                       |

There is no raw fingerprint, behavior summary, debug record, IP, secret, email key or anonymous learning prediction in these events. Actor/subject fields come from the private credential assessment. Low automation never turns an unknown actor into a verified person. Stable actor IDs allow distinct counting without merging users who share a browser/account. Use the same actor ID conventions throughout the application; prefix separately managed agent IDs to prevent collisions with human IDs.

Actor counting starts when events contain these new fields; older exports cannot retroactively supply missing actor IDs. Analytics is a reporting system, not the source of authentication or membership. Projects that accept events using public browser tokens can receive fabricated events, so reports alone must never grant access or serve as an authoritative security audit.

| Question                                                                   | Aggregation and filter                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| How many humans used account X this month?                                 | Distinct `janitor_actor_id`; account X, kind `person`, basis `verified-credential`, chosen time window |
| How many agents used it?                                                   | Same, kind `agent`; filter valid delegation when asking about delegated agents                         |
| Has one browser been used by multiple people?                              | Distinct actor IDs grouped by visitor ID; verified persons only; count > 1                             |
| How many browsers did a person use?                                        | Distinct visitor IDs for one actor; these are browser environments, not guaranteed physical devices    |
| What activity came from unknown operators?                                 | Event count where actor basis is `unknown`; do not turn that into a number of people                   |
| How many members/agents are authorized right now, including inactive ones? | Your current membership/delegation database, not historical analytics events                           |

These reports count **observed active actors**, not everyone registered. An invalid delegation can still describe an observed authenticated agent, so explicitly require `janitor_delegation_status = valid` when counting observed authorized delegations. Historical events remain historical after revocation. No report can count distinct physical humans sharing one undifferentiated credential. Browser-cookie copying and probabilistic recovery also mean a shared visitor ID is evidence to investigate, not proof that people share a physical device.

### Mixpanel report setup

In Insights, select `janitor identified`, filter `janitor_account_id = your-account` and `janitor_actor_basis = verified-credential`, then measure **Distinct count of property → janitor_actor_id**. Break down by `janitor_actor_kind`. Use the total over your chosen date range; adding daily unique counts double-counts returning actors. For shared-browser analysis, filter kind `person` and break down by `janitor_visitor_id` instead. These reports use event properties and do not require enabling Group Analytics. [Mixpanel distinct-property measurements](https://docs.mixpanel.com/docs/reports/insights).

If you already use provider account/group analytics, opt into `accountGroup: "account"` on the TypeScript bridge or `account_group: "account"` in native provider options. Janitor attaches each event to that account: PostHog `groups`/`$groups`, Mixpanel the configured group-key property. Earlier events retain their original account when a user switches workspaces. The plain `janitor_account_id` field remains available either way. Group support must already be enabled/configured in your project; Janitor does not purchase an add-on or create/change group definitions. [PostHog groups](https://github.com/PostHog/posthog.com/blob/master/contents/docs/product-analytics/group-analytics.mdx), [Mixpanel groups](https://docs.mixpanel.com/docs/data-structure/group-analytics).

### PostHog SQL recipes

Copy into PostHog SQL and replace the example account literal with your selected account. These recipes are supplied for your project; they have not been executed against a live analytics project.

```sql
SELECT properties.janitor_actor_kind AS actor_kind,
       uniqExact(properties.janitor_actor_id) AS observed_actors
FROM events
WHERE event = 'janitor identified'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.janitor_account_id = 'account-example'
  AND properties.janitor_actor_basis = 'verified-credential'
  AND properties.janitor_actor_id IS NOT NULL
GROUP BY actor_kind
```

```sql
SELECT properties.janitor_visitor_id AS browser_id,
       uniqExact(properties.janitor_actor_id) AS verified_people
FROM events
WHERE event = 'janitor identified'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.janitor_account_id = 'account-example'
  AND properties.janitor_actor_kind = 'person'
  AND properties.janitor_actor_basis = 'verified-credential'
  AND properties.janitor_actor_id IS NOT NULL
  AND properties.janitor_visitor_id IS NOT NULL
GROUP BY browser_id
HAVING verified_people > 1
ORDER BY verified_people DESC
```

PostHog documents [`uniqExact` and conditional aggregates](https://github.com/PostHog/posthog.com/blob/master/contents/docs/sql/aggregations.mdx). Scope reports to the intended account, time window and identity namespace. Rotating the directory secret changes opaque actor IDs and can split historical counts; plan that migration explicitly.

### Questions for your analytics assistant

Once events are ingested, give the provider's assistant this metric definition along with your question:

> Use the `janitor identified` event. For account `account-example` over the last 30 days, count distinct `janitor_actor_id`, filtering `janitor_actor_basis = verified-credential`, and break down by `janitor_actor_kind`. Separately show observed agents with valid delegation. Do not count visitors as people, unknown operators as humans, or events as users. Show the report/query and time window used.

> For that account and date range, which `janitor_visitor_id` values had more than one distinct verified person? Report the count and IDs without merging their profiles. Describe these as browser-continuity associations, not proof of shared hardware or account compromise.

The library prepares the event schema; it does not add an AI query agent or a new dashboard. These prompts require the analytics product's query/assistant capability and your access permissions. Do not feed browser scores into a frontend AI assistant; use authorized access to the server-ingested analytics dataset.

## Rollout and validation

Connect one provider first, then the other if needed. In a development project, verify: anonymous visit → login → second device login to the same user → logout → different user on the original browser → delegated agent with its own ID. Confirm one profile per actor, two profiles for two people sharing a browser, the intended account on every event, and no private scores in browser requests. Check rejected/late events and regional ingestion hosts. Analytics deletion and consent withdrawal must follow your provider's own lifecycle as well as Janitor erasure.

The repository tests the actual installed PostHog and Mixpanel browser SDKs with all analytics requests intercepted locally, and native HTTP payloads with mocked transports. No live provider profile merge, dashboard count, project setting or Open Calls deployment is claimed. Transport acceptance does not establish a report's accuracy; review ingestion and distinct-count results in your own project before using them operationally.
