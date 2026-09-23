# Suspicious activity across linked sessions

An attacker can rotate IP addresses and sessions. The useful evidence is often the sequence of attempted actions: repeated denied access, attempts against sensitive operations, and reuse of a distinctive request pattern or application identifier.

Janitor can now assess that activity across **probabilistically linked groups** without merging user identities. This is optional, server-side correlation in the TypeScript activity service. It uses the existing D1/Postgres activity tables and does not collect IP addresses or inspect request bodies automatically.

## Configure and supply evidence

```ts
const janitor = createNodeVisitor({
  db,
  identity: {
    secret: process.env.JANITOR_IDENTITY_SECRET!,
    namespace: "my-app",
  },
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  activity: {
    routes: [{ route: "POST /api/orders", sensitive: true }],
    correlation: { minConfidence: 0.8 },
  },
});

// Your server selects a canonical, non-sensitive shape label and a reviewed
// stable reference. Do not pass raw bodies, passwords, tokens or IP addresses.
const correlation = await janitor.activity!.correlation({
  basis: "request-pattern",
  confidence: 0.92, // Your measured linkage estimate, not a default for every shape.
  parts: [
    { kind: "shape", value: "order-create-v2:invalid-target" },
    { kind: "application", value: campaignReferenceFromYourScreening },
  ],
});
const context = {
  key: { kind: "session" as const, id: serverSession.id },
  route: "POST /api/orders",
  correlations: [correlation],
};
const { response, activity } = await janitor.activity!.handle(
  request,
  context,
  handleOrderWithExistingAuthorization,
);
// activity.assessment is private. Keep your policy and authorization on the server.
return response;
```

The application functions and references in this example are yours. Janitor does not invent a campaign ID or confidence from an arbitrary JSON body. Use canonical schema variants or allowlisted operation categories for shapes, plus an independently useful reference. A shared endpoint or shape alone is rejected as a correlation key. A shape plus a common target can still group unrelated people; keep that confidence low or omit the link. Avoid grouping all failed logins to one victim as one attacker.

Other bases are `browser-match`, using a browser reference from your screening and its measured confidence, and `verified-identifier`, using an application-verified reference. Browser matching is fallible. Never treat a browser body, claimed email, copied cookie or model guess as verified authentication. Distinct values receive distinct application-scoped HMAC references; raw components are neither stored nor sent to Jev. Identical components in different application namespaces produce different references.

## What changes in the score

A completed request updates its own session/actor aggregate and at most three admitted correlation groups. Links below your configured confidence threshold are excluded. A subsequent session can receive the group's recent denied-operation history even if it has no completed requests of its own. IP rotation has no effect on those keys.

The evaluator receives the group's action summaries, link basis, current-link confidence and the minimum confidence admitted for earlier contributions. Groups and cached assessments are scoped to that admission threshold; raising it cannot reuse weaker historical groups. Repeated denials against sensitive operations can increase `suspicious`; similar request shapes, legitimate automation, retries and shared targets alone should not. The Jev prompt explicitly distinguishes these cases. `automation` remains separate. Model outputs are experimental scores, not calibrated attacker probabilities, and application policy owns any response.

Groups can overlap each other and the primary session. Janitor marks them as related summaries and instructs the evaluator not to add their counts or regard them as independent witnesses. It never reports a group as a verified common person, merges analytics identities, or changes permissions.

## Bounds, privacy and failure behavior

This adds at most three aggregate writes and three indexed history reads per observation/assessment. It performs no global database scan and introduces no queue or new service. Groups use the existing window, retention, timeout and concurrency limits. With related groups present, Jev receives up to 32 primary buckets and 16 per group; truncated summaries are marked. Group references, bases and confidence enter the private cache key so a result is not reused across different linkage assumptions. The default evaluation cache is one minute; a cached score can lag newly recorded activity.

The assessment includes `relatedActivity` privately. The browser response is unchanged. On evaluator failure, scores remain zero with `riskStatus: "unavailable"`; storage trouble returns a controlled unavailable activity result. No middleware decision blocks the original request.

Collection requires both `activity.correlation` configuration and server-supplied correlations for a request. Stop collection before erasing. `deleteCorrelation(correlation)` erases that entire shared aggregate group; it cannot subtract a single contributor from already aggregated counters. Also call `deleteKey(sessionOrActorKey)` for affected sessions to clear their cached assessments. Otherwise those private cached summaries remain until their short expiry. Standard `cleanup()` expires historical group buckets. Disclose this extra aggregation and choose short retention appropriate to your application.

The storage and mocked-evaluator tests cover changing sessions, cross-replica accumulation, namespace isolation, weak-link exclusion, identifier projection and group deletion. They do **not** establish real-world attacker detection accuracy. Calibrate linkage and abuse separately using reviewed incidents and legitimate shared-device/shared-client controls.

Correlation erasure uses the same admission-threshold configuration that recorded a group. If you change that threshold, earlier policy groups remain isolated and expire under their original retention; erase them using a service configured with the earlier threshold when immediate deletion is required.
