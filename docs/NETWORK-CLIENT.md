# Connect your application to the learning service

Use the learning service from your server. Keep its API key out of browser bundles and analytics events. Ordinary visitor identification continues to work without this service.

`@janitor/network` is currently available from the repository source. Clone the repository, run `pnpm install && pnpm build`, and use a workspace dependency or `pnpm pack:all` to produce local installable archives. The existing v0.9.0 release archives do not contain this new package.

## Get a private assessment

```ts
import { createNetworkClient, extractFeatures } from "@janitor/network";

const network = createNetworkClient({
  endpoint: process.env.JANITOR_NETWORK_URL!,
  apiKey: process.env.JANITOR_NETWORK_KEY!,
});

// `assessment` comes from visitor.activity.assess() on your server.
const features = extractFeatures({
  activity: assessment.summary,
  routes: {
    "GET /api/orders/:id": "read",
    "POST /api/tools/:name": "tool",
    "POST /api/telemetry": "telemetry",
  },
});
const result = await network.evaluate(features);
// Keep result private; your application chooses the policy.
```

The operator issues your key. Enable evaluation once with `network.preferences({ evaluation: true, contribution: false, training: false })`. This preference alone does not enable a provider or increase the operator's spending limits.

If you want the existing visitor engine to use these risk assessments, `withNetworkRisk(baseEvaluator, network, { routes })` wraps your evaluator while retaining its identity matching. Configure a combined evaluator deadline that accommodates both provider calls. The wrapper keeps the base result if the network is unavailable. It never uploads contributions automatically.

## Contribute explicitly

```ts
const contributor = createNetworkClient({
  endpoint: process.env.JANITOR_NETWORK_URL!,
  apiKey: process.env.JANITOR_NETWORK_KEY!,
  contribution: {
    enabled: true,
    training: true,
    sampleRate: 0.01,
    referenceSecret: process.env.JANITOR_NETWORK_REFERENCE_SECRET!,
  },
});

// Set once after choosing your application's collection policy.
// Training also requires operator approval for this participant.
await contributor.preferences({
  evaluation: true,
  contribution: true,
  training: true,
});

const sample = await contributor.prepare({
  sessionId: serverSession.id,
  features,
  cohort: "unknown", // Use only independently known evaluation context.
});
// Inspect `sample` locally. Retain this same object for any explicit retry.
const upload = await contributor.contribute(sample);
if (upload.status === "accepted") {
  // Store upload.sampleId with your application session for later feedback/erasure.
}
```

The reference secret must be random, application-specific and at least 32 characters. It creates daily rotating session references; raw session IDs stay with you. References and behavior summaries remain pseudonymous data.

After independently verifying a delegated assistant, pass **server-resolved attribution**:

```ts
await contributor.confirmAssistant(sample.sampleId, identity.attribution!);
```

Do not pass attribution supplied by browser JSON. This helper checks the verified-agent/valid-delegation shape; it relies on your server having actually run the credential and delegation checks. Do not label ordinary logged-in accounts as reviewed humans automatically.

For a reviewed outcome, use explicit feedback:

```ts
await contributor.feedback({
  sampleId: sample.sampleId,
  target: "abuse", // Separate from "assistant".
  positive: true,
  source: "confirmed-incident",
  evidenceReference: await contributor.evidenceReference(internalCase.id),
});
```

Allowed sources are `verified-delegation` (positive assistant only), `confirmed-incident` (positive abuse only), and `reviewed-session`. Source claims are attestations by your application, not independently checked by the shared service. Contradictory feedback becomes disputed.

## Operation sequences

```ts
import { createSequenceTracker } from "@janitor/network";
const sequence = createSequenceTracker(); // Owned by one session/window.
sequence.observe("telemetry", performance.now());
sequence.observe("tool", performance.now());
const enriched = extractFeatures({
  activity: assessment.summary,
  routes: configuredRouteCategories,
  sequence: sequence.snapshot(),
  behavior: validatedBrowserBehavior, // Optional; already collected with opt-in.
});
```

Call `observe()` when your server receives the configured operation, using one monotonic clock. The tracker emits timing statistics after sufficient observations. It does not attach listeners, intercept network traffic, or persist across separate server instances. In a distributed application, use your existing ordered session event stream to derive these features.

## Stop and erase

Stop scheduling contributions in your application before revocation. `contributor.preferences({ evaluation: true, contribution: false, training: false })` disables contribution and deletes that participant's contributed samples and labels. Disabling only training removes eligibility from existing samples; re-enabling affects new samples only.

Use `contributor.erase(sampleId)` to erase one contributed snapshot or `contributor.erase()` to erase all of your participant's contributions. Retain the mapping needed to include this in account/session deletion. Erasure remains available after the daily ingestion quota is exhausted. Backups and separately exported data require their own deletion policy.

See [how discovery and validation work](LEARNING-NETWORK.md) before using a pattern match in application policy.

## Train a supervised classifier

The learning service also supports an offline classifier pipeline. Compare telemetry-only logistic/boosted-tree models with optional Jev features, using independently confirmed outcomes and a separate calibration window. Private `network.classify(features)` results describe assistant and abuse targets; they do not replace authentication or the existing risk result. Follow [Train a Janitor classifier](CLASSIFIER.md) for setup, validation, budgets and rollback.
