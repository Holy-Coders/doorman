# @aarondovturkel/doorman-network

> Contributor research module, outside the recommended Doorman integration. It is not needed for browser identity, analytics or Jev cross-device suggestions. See the [current docs](https://doorman.holycoders.io/docs/introduction/) before using the archived workflows below.

Optional, server-side pattern learning for Doorman. Contribute sampled numeric summaries and independently confirmed outcomes, discover recurring combinations, and test them on later sessions from unseen applications before supplying them to Jev.

Ordinary Doorman installations do not contact this service. Evaluation, contribution and training are separate opt-ins. Patterns never authenticate a person or authorize an agent.

```ts
import { createNetworkClient } from "@aarondovturkel/doorman-network";

const network = createNetworkClient({
  endpoint: process.env.DOORMAN_NETWORK_URL!,
  apiKey: process.env.DOORMAN_NETWORK_KEY!,
});

// Keep this assessment on your server. Evaluation does not contribute training data.
const assessment = await network.evaluate({
  api_request_count: 40,
  api_gap_cv: 0.2,
  route_telemetry_share: 0.3,
});
```

An operator must provision the tenant, enable its evaluation preference, and configure inference budgets. Disabled or unavailable evaluation is explicitly reported; zero risk is not proof of safety.

- [Connect, contribute and confirm outcomes](https://github.com/Holy-Coders/doorman/blob/main/docs/archive/NETWORK-CLIENT.md)
- [Discovery, validation and limitations](https://github.com/Holy-Coders/doorman/blob/main/docs/archive/LEARNING-NETWORK.md)
- [Train and evaluate a classifier](https://github.com/Holy-Coders/doorman/blob/main/docs/archive/CLASSIFIER.md) — optional `network.classify(features)`, separate assistant/abuse targets, private shadow/canary results.
- [Postgres deployment](https://github.com/Holy-Coders/doorman/tree/main/examples/learning-service)
- [Cloudflare D1 deployment](https://github.com/Holy-Coders/doorman/tree/main/examples/learning-worker)
- [Versioned HTTP schema for other languages](https://github.com/Holy-Coders/doorman/blob/main/protocol/network.schema.json)

This developer preview is available as `@aarondovturkel/doorman-network`. Its synthetic experiments establish implementation behavior, not real-world detection accuracy.
