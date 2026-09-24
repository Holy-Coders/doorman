# Request limits and AI budgets

The recommended `createDoorman` handler includes database-backed limits so browser measurements cannot start unlimited Jev calls. These controls protect the measurement endpoint. Your existing authentication, gateway limits and application policy still protect business actions.

## Defaults

The TypeScript `createDoorman` flow starts with:

| Control                     | Default                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| Measurement requests        | 600 per minute globally, 60 per supplied account and 30 per supplied session.     |
| Provider calls              | 60 reserved calls per minute across instances sharing the database and namespace. |
| Provider concurrency        | Four reserved calls at once.                                                      |
| Repeated provider failures  | Pause after three failures; try recovery after 30 seconds.                        |
| Measurements in one handler | 64 in flight; reuse the handler to make this limit effective.                     |

An identity/risk evaluation reserves two provider calls. Optional cross-device and API activity evaluation share the same budget. This is a call-count limit, not a guaranteed dollar cap. Provider timeouts may still incur charges.

## Adjust the limits

```ts
import { createDoorman } from "@aarondovturkel/doorman-adapters/node";

const secret = process.env.DOORMAN_IDENTITY_SECRET!;
const namespace = "my-app";
const doorman = createDoorman({
  db,
  secret,
  namespace,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  evaluatorTimeoutMs: 1200,
  maxInFlightRequests: 32,
  protection: {
    secret,
    namespace,
    requests: { global: 600, account: 60, session: 30, windowMs: 60_000 },
    evaluator: { maxCalls: 60, windowMs: 60_000, maxConcurrent: 4 },
  },
});
```

These are example operating limits, not throughput targets. Use the same configuration across replicas. Tables are created automatically. No separate protection service or migration is required.

Supply trusted account/session keys when those limits should apply:

```ts
const result = await doorman.assess(request, {
  auth: currentUser ? { userId: String(currentUser.id) } : undefined,
  admission: {
    account: currentAccount ? String(currentAccount.id) : undefined,
    session: serverSession.id,
  },
});
return result.response;
```

The application owns `currentUser`, `currentAccount` and `serverSession`. Never use an arbitrary header, browser JSON value or guessed person ID as a trusted limiter key. Configure database pool and query deadlines separately.

Native Phoenix uses its application's HTTP/DBConnection admission controls and the configured evaluator protection. Its limits use snake-case options; see the [native setup](../packages/elixir/README.md).

## Handle limits and failures

- A measurement request quota returns `429` with `Retry-After`.
- A full TypeScript handler or unavailable protection/database storage returns a controlled `503`.
- An exhausted AI budget, timeout or provider failure keeps browser measurement working where storage is available, with `riskStatus: "unavailable"`.

Catch measurement failures in your client so analytics cannot break a successful login. An unavailable zero score does not mean a request is safe. Doorman does not automatically block your checkout, challenge users or show a CAPTCHA.

## Add facts your application knows

Pass bounded server counters through `riskEvidence`, or configure [API activity](API-ACTIVITY.md) for selected route templates. Trusted edge metadata and optional network reputation are described in [identity context](IDENTITY-CONTEXT.md). Risk evidence is kept separate from identity matching.

Use your own observability for request counts, latency, errors and budget denials. Do not log full browser payloads, raw IPs, credentials or private candidate identities. [Deployment and scale](SCALING.md) explains what to measure before increasing limits.
