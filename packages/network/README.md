# @janitor/network

Optional, server-side pattern learning for Janitor. Contribute sampled numeric summaries and independently confirmed outcomes, discover recurring combinations, and test them on later sessions from unseen applications before supplying them to Jev.

Ordinary Janitor installations do not contact this service. Evaluation, contribution and training are separate opt-ins. Patterns never authenticate a person or authorize an agent.

```ts
import { createNetworkClient } from "@janitor/network";

const network = createNetworkClient({
  endpoint: process.env.JANITOR_NETWORK_URL!,
  apiKey: process.env.JANITOR_NETWORK_KEY!,
});

// Keep this assessment on your server. Evaluation does not contribute training data.
const assessment = await network.evaluate({
  api_request_count: 40,
  api_gap_cv: 0.2,
  route_telemetry_share: 0.3,
});
```

An operator must provision the tenant, enable its evaluation preference, and configure inference budgets. Disabled or unavailable evaluation is explicitly reported; zero risk is not proof of safety.

- [Connect, contribute and confirm outcomes](https://github.com/Holy-Coders/janitor/blob/main/docs/NETWORK-CLIENT.md)
- [Discovery, validation and limitations](https://github.com/Holy-Coders/janitor/blob/main/docs/LEARNING-NETWORK.md)
- [Postgres deployment](https://github.com/Holy-Coders/janitor/tree/main/examples/learning-service)
- [Cloudflare D1 deployment](https://github.com/Holy-Coders/janitor/tree/main/examples/learning-worker)
- [Versioned HTTP schema for other languages](https://github.com/Holy-Coders/janitor/blob/main/protocol/network.schema.json)

This pilot is available from the repository workspace and `pnpm pack:all` archives. Registry publication is separate. Its synthetic experiments establish implementation behavior, not real-world detection accuracy.
