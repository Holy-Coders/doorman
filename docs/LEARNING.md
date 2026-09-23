# Learn from later logins

Suppose a visitor browses your app anonymously and then signs in. That login gives you a verified account label for the short session leading up to it. Janitor can optionally save those examples in your database so you can study whether past visits help predict later logins.

With Jev configured, Janitor now uses those examples automatically to evaluate later anonymous visits, including visits from another device. You do not need to write a predictor. The result is a private suggestion, separate from a verified login. Predictions are recorded before the person signs in so you can compare them with the eventual login. This is called **shadow mode**.

This is learning from a growing history of confirmed sessions, not retraining Jev. A brand-new installation has no person history. Jev cannot know who an anonymous person is just because it is enabled.

Browser recognition, user updates and risk scoring all work with this feature off. Enable it when your application wants to collect login feedback and evaluate these suggestions. First set up the [identity directory](AGENTIC-IDENTITY.md); it supplies the verified user labels.

## Enable collection explicitly

Apply all migrations through `0007_learning_lookup.sql`; the last migration adds indexes for learning retrieval. Configure the identity directory and opt in on the server:

```ts
const visitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  identity: {
    secret: process.env.JANITOR_IDENTITY_SECRET!,
    namespace: "my-app",
  },
  learning: {
    enabled: true,
    collectionPolicy: "application", // No separate per-request flag required.
    // With Jev configured, shadow predictions are automatic.
    retentionDays: 30,
    sessionMinutes: 30,
  },
});
```

Cloudflare and Vercel accept the same options. Omitting `learning`, or setting it to `false`, disables the feature: no learning queries, collection cookie, or predictor calls. The browser observation and risk library remains independent.

Choose when collection is allowed in your server configuration. `collectionPolicy: "application"` collects without a per-request consent flag; `learningConsent: false` still opts that request out. The default `"per-request"` requires `learningConsent: true`. This is an implementer policy switch, not a built-in consent UI. Identity, account updates and risk work regardless of learning being enabled.

```ts
learning: { enabled: true, collectionPolicy: "application" }
```

For per-request control, use your existing server-side preferences/policy:

```ts
// These are application-owned functions, not Janitor APIs.
const collectionAllowed = await appAllowsLearning(request);
const authenticated = await authenticateRequest(request);

let verified;
if (authenticated) {
  const person = await visitor.identities!.updateSubject({
    id: authenticated.accountId,
    kind: "person",
  });
  // Set actorId only when authentication establishes this actor too.
  verified = { subjectId: person.id, actorId: person.id };
}

return visitor.handle(request, {
  learningConsent: collectionAllowed === true,
  ...(verified ? { verified } : {}),
});
```

Call the endpoint during the anonymous visit and again after login, before the learning cookie expires. The library cannot discover a login that your application never reports. Do not copy consent, subject or actor claims from untrusted JSON or headers. In the default per-request policy, requests without `learningConsent: true` do not collect learning data. The application-wide policy does not need this per-request flag. The HTTP body accepts browser measurements only.

Browser tracking has its own lifecycle. Instantiate the browser client only when your application permits collection, and call `destroy()` when permission is withdrawn. Enabling learning does not enable extended movement/timing summaries; those require the separate `behavior: "extended"` browser option.

## What a learning session means

1. When the selected policy permits collection, the server creates a cryptographically random `__visitor_learning` cookie. It is HttpOnly, Secure, SameSite=Lax, host-only and valid for a fixed 30 minutes by default.
2. Anonymous requests update one latest normalized snapshot, including the aggregate behavior the browser client supplied. Janitor stores no page sequence, URL history or raw input events.
3. A verified self-person login labels that snapshot and clears the cookie. Post-login measurements cannot overwrite the labeled snapshot. Unknown actors, delegated family members and agent activity are excluded from labels.
4. Repeated confirmation for the same account is harmless. Conflicting account confirmations mark the flow disputed and exclude it from feedback. This cannot eliminate shared-browser ambiguity; it prevents known conflicting evidence from being used.
5. A restored `visitorId` is never enough to label a session. Cookie loss ends continuity for this learning flow. A new learning cookie starts a new flow even when browser matching restores an older visitor ID.

The short-lived cookie connects measurements within one learning session. It does not authenticate the visitor. A stolen/replayed cookie is not physical-user proof. Use HTTPS and your application's authenticated route boundary. Different application namespaces scope learning lookups, but the complete Janitor database is not a general multi-tenant service: keep a dedicated database/schema per application.

## Inspect feedback on your server

```ts
const examples = await visitor.learning!.reports(100); // Limit 1–100.
// [{ sessionId, subjectId, observation, observedAt, verifiedAt, prediction }]
```

Reports contain recent, undisputed, verified examples only. Treat this export as sensitive pseudonymous data. Do not expose it through a public endpoint or send it to ordinary logs. Only opaque subject IDs are stored here; verified key values and raw emails are not included.

## Read a cross-device suggestion

```ts
const assessment = await visitor.assess(request, trustedContext);
console.log(assessment.learning);
// { status: "suggested", subjectId: "sub_...", score: 0.96 }
// or { status: "abstained" | "not-run" | "unavailable" }
return assessment.response; // The suggestion is not in this browser response.
```

In Phoenix the same result is in `conn.assigns.janitor_learning` after `Janitor.handle`. Enable it with:

```elixir
Janitor.new(
  repo: MyApp.Repo,
  evaluator: [api_key: System.fetch_env!("JEV_API_KEY")],
  identity: [secret: System.fetch_env!("JANITOR_IDENTITY_SECRET"), namespace: "my-app"],
  learning: [enabled: true, collection_policy: :application]
)
```

The server must still report verified logins as shown above. The [Janitor browser client](ANALYTICS.md) calls the measurement endpoint again when you call `janitor.identify(user.id)` after login.

## How Jev uses the history

1. Two indexed queries retrieve login-confirmed sessions with a matching normalized language bucket or timezone within your application namespace. These are search hints, not person-identity proof. Each query reads at most 101 rows.
2. If either bucket or the combined unique set exceeds 100 sessions, Janitor abstains. It does not guess from a crowded, truncated cohort. This favors missed suggestions over false person links; common locales in a large application may often abstain.
3. Janitor groups the retained examples into at most ten people and sends up to three examples per person. A person needs at least two independently confirmed sessions. If more than ten people qualify, Janitor abstains instead of hiding alternatives from the model. Previous predictions never become examples.
4. Jev answers one typed question per candidate person in a single request. It is asked to allow device changes and to treat matching locale alone as insufficient evidence.
5. A suggestion needs a score of at least `0.90` and a `0.10` lead over alternatives. Otherwise it abstains. These are experimental thresholds, not measured accuracy guarantees.

Only compact observations and observation times enter the model. Persistent subject IDs and session IDs are replaced with request-local array indexes and mapped back on your server. Protected adapters share the same inference quota across lookup planning, browser evaluation and learning.

A suggestion never merges an analytics profile, populates authenticated `subjectId`, grants a permission or changes browser matching. A verified login remains the point at which Janitor connects the known person across devices in PostHog, Mixpanel or Segment.

## Collection only or a custom predictor

Set `mode: "collect"` to save feedback without making learning inference calls. Without Jev or a custom predictor, collection is the default. To replace Jev's cross-device evaluation, supply a callback:

```ts
learning: {
  enabled: true,
  mode: "shadow",
  evaluatorTimeoutMs: 1200,
  predict: async ({ current, examples }) => {
    // Call your separately evaluated classifier here.
    // Return {} to abstain, or a subject from examples and a score in [0, 1].
    return {};
  },
}
```

A custom predictor receives the bounded indexed cohort (at most 100 examples), without previous predictions. Janitor keeps up to 20 confirmed sessions per person. Custom storage without `findExamples` can fall back to its bounded `reports` method. A person outside the retrieved cohort cannot be predicted.

Predictions are recorded before login and compared with the subsequently verified account in `reports()`. They never populate browser responses, authenticate a person, merge subjects, affect visitor matching, change risk scores, or grant permissions. Scores are uncalibrated. Unknown subject IDs, out-of-range values, exceptions and timeout produce `prediction.status: "unavailable"`; returning `{}` produces `"abstained"`. Collection mode records `"not-run"`.

Repeated calls to Jev do **not** retrain it. Keeping verified examples can support few-shot evaluation or a separately trained classifier, but Janitor includes no model-training pipeline. If your callback calls a remote provider, explicitly approve that data transfer, minimize the examples, remove opaque account/session references before inference where possible, map outputs back server-side, and enforce the provider's own abort timeout. Janitor stops waiting after its timeout; it cannot cancel arbitrary user callbacks.

## Retention and erasure

- Defaults: 30-day retention, 30-minute fixed session lifetime. Accepted ranges: retention 1–90 days, session 1–60 minutes, predictor timeout 1–5000 ms.
- Confirmation prunes to the latest 20 sessions per subject. Pruning follows the label write; interrupted pruning is repaired by cleanup. `reports()` filters expired retained labels and reads at most 100.
- `await visitor.cleanup()` removes expired anonymous flows, disputed flows, old snapshots and surplus examples. Use your existing maintenance schedule; there is no Janitor worker or queue.
- `await visitor.learning!.deleteSession(sessionId)` deletes one authorized flow. `await visitor.identities!.deleteSubject(subjectId)` cascades to learning rows labeled with, or predicting, that subject.
- Sending a request with collection permission false deletes its current learning-cookie row and clears that cookie. This does not erase older completed sessions: use account deletion or authorized session deletion for those.
- Disabling the feature stops collection and clears a stale cookie when seen; it does not erase the database. Before removing learning configuration, erase records according to your retention policy or run `createD1LearningStorage(db).cleanupLearning(...)` / its Postgres equivalent from a privileged maintenance task. An application-wide authorized SQL deletion can remove the learning table's data in a dedicated database.

## Measure before acting on predictions

Evaluate on consented real sessions with verified accounts, including multiple physical devices, shared devices, privacy browsers and accounts absent from the candidate set. Freeze inputs and predictions before login. Test with visits that occur after the training examples and with devices excluded from those examples. These are called chronological and device holdouts. Near-duplicate snapshots from the same session must not appear on both sides of the test. Report false associations, precision, recall, abstention, coverage, calibration and cost/latency together. Login-only feedback is selection-biased and says nothing about sessions that never authenticate. It also does not label bot activity or malicious intent.

Janitor's automated tests verify these collection and trust boundaries. They do not establish anonymous cross-device accuracy. The existing generated browser dataset is useful for regression testing, not evidence that unrelated devices can be attributed to a person.
