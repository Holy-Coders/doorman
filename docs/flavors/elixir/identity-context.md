# One identity integration in Phoenix

**0.13 is currently available from source.** The latest npm and Hex release is 0.12.0. The unified API below requires the source checkout, not the current registry release. [Run from source](https://github.com/Holy-Coders/doorman).

Use your existing Ecto repository and authentication pipeline. Doorman remembers browser relationships and returns private estimates; it does not replace login or grant permissions.

```elixir
# mix.exs
{:doorman_identity, "~> 0.13.0"}
```

In a new migration, call `Doorman.Migration.up()`. For an existing 0.12 installation, call `Doorman.Migration.upgrade_context()` instead. This adds one indexed association table. Run your normal Ecto migration command before deployment.

```elixir
doorman = Doorman.new(
  repo: MyApp.Repo,
  secret: System.fetch_env!("DOORMAN_IDENTITY_SECRET"),
  namespace: "my-app",
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  cross_device: true
)

# Your authentication plug owns current_user and current_account.
auth = if user = conn.assigns[:current_user] do
  %{user_id: to_string(user.id), account_id: to_string(conn.assigns.current_account.id)}
end
conn = Doorman.handle(conn, doorman, %{auth: auth})
```

`secret` must be a stable server secret of at least 32 characters. `namespace` identifies your application; use an application-owned database/schema too. `cross_device` is optional and off by default. Omit `evaluator` to avoid model calls.

The controller sends `{visitorId, sessionId, isReturning}` to the browser. Private results are in `conn.assigns.doorman_context`, `doorman_identity`, `doorman_properties`, and `doorman_risk_evidence`.

| Context status  | Meaning                                                           |
| --------------- | ----------------------------------------------------------------- |
| `authenticated` | Your server verified the current user/actor.                      |
| `remembered`    | A retained browser cookie previously accompanied a verified user. |
| `inferred`      | Browser or login history suggests a possible relationship.        |
| `ambiguous`     | Several retained relationships used this browser.                 |
| `unknown`       | Insufficient evidence.                                            |

Remembered and inferred context is never authorization. Missing-cookie matches receive a fresh browser ID and a private suggestion. Cross-device feedback uses anonymous observations later confirmed by self-login; predictions never become training labels or analytics aliases.

For an authenticated agent, add `actor: %{id: agent.id, kind: :agent}` to `auth`. The application must have verified that credential and its authority to act for the user. Use separately authenticated members to distinguish humans sharing an account; telemetry cannot prove a household relationship or the number of people using one password.

## Browser and analytics

Serve the bundled browser module with your existing `Plug.Static` configuration. Preserve Phoenix CSRF protection as shown in the [runnable example](../../../examples/phoenix/README.md).

```js
import { createDoormanClient } from "/doorman/doorman.js";
const doorman = createDoormanClient({
  collection: "extended",
  headers: () => ({
    "x-csrf-token": document.querySelector("meta[name=csrf-token]").content,
  }),
  analytics: { posthog, mixpanel },
});
await doorman.identify();
// After login:
await doorman.identify({ userId: user.id, accountId: account.id });
// Existing provider events also receive safe context.
await doorman.track("Project created");
// On logout:
await doorman.reset();
```

Minimal collection is the default. Extended collection enables bounded aggregate behavior, runtime, permission, target/focus and font probes. No keys, coordinates, forms or recordings are retained. Call `destroy()` on teardown. Provider replay/autocapture remains governed by your own provider settings.

The browser SDK registers only safe browser/session/account properties. Private `doorman_properties` can be attached to server events using your existing analytics SDK. If using Doorman's explicit server analytics exporters with `analytics_consent: true` and a server-owned `analytics_id`, that context snapshot is included automatically.

Build normal funnels with verified identity joins. Group accounts by verified subjects/actors and count browsers separately. Analyze tentative candidate properties in a separate report; never call analytics identify with a guessed subject. Human/assistant/script scores are experimental and unavailable on sparse sessions; they are not reliable operator headcounts or agent brands.

## Request and network evidence

Pass server-owned counters in `risk_evidence`, using string keys:

```elixir
context = %{risk_evidence: %{"activity" => %{
  "windowMs" => 60_000, "requests" => 40,
  "denials" => 8, "authenticationFailures" => 3
}}}
Doorman.handle(conn, doorman, context)
```

The optional [API activity middleware](api-activity.md) records selected route templates and outcomes. Related-session activity requires explicit application correlation hooks. These services remain optional.

Optional `reputation: [api_key: System.fetch_env!("ABUSEIPDB_API_KEY")]` plus `client_ip` from a trusted server resolver enables read-only AbuseIPDB checks. Defaults: 500 ms deadline, five-minute database cache, shared 100/hour budget. The provider receives the IP; Doorman stores HMAC cache keys and a small scored summary, never raw IPs, and never sends raw IPs to Jev. No automatic abuse reports. A network listing does not establish a person's conduct.

Reputation and request-risk evidence reach risk questions only. Failed providers return unavailable status. No automatic CAPTCHA or application blocking occurs. Keep your authentication and authorization in place.

## Maintenance

`Doorman.cleanup(doorman)` expires associations after the configured retention period (90 days by default). `Doorman.forget_user(doorman, raw_user_id)` erases the user's directory, retained associations and dependent learning history. `Doorman.delete_visitor` erases a browser and its associations. Delete copies exported to analytics using the provider's API as well.

Read [the full context contract](../../IDENTITY-CONTEXT.md) for scoring limits, budgets and the underlying TypeScript counterparts.
