# Doorman: one identity context

Doorman remembers browsers, connects application-verified users and agents, and assesses uncertain identity and activity. An application installs a browser client and a server module beside its existing database. Analytics remains in PostHog, Mixpanel or the application's existing provider.

## The integration

`createDoorman({ db, secret, namespace, evaluator, crossDevice })` is the recommended server entry point. `assess(request, { auth })` returns a public HTTP response and a private context. Authentication comes from server middleware. The browser never supplies trusted user, account, agent, IP or reputation claims.

The browser uses `createDoormanClient({ analytics, collection: "extended" })`, then `identify`, `track`, `update` and `reset`. Existing PostHog/Mixpanel calls receive safe browser/account context through their supported super-property APIs. Private scores and inferred user IDs remain server-side.

## Facts and estimates

- A retained cookie establishes browser-ID continuity, not a human identity.
- A server-authenticated user/account/actor is current verified context.
- Previous authenticated browser associations are remembered context, never current authentication. Shared browsers return several associations rather than choosing the most recent person.
- Missing-cookie matches are suggestions. The recommended flow assigns a fresh browser ID and preserves a possible previous-browser association separately.
- Cross-device suggestions use only independently login-confirmed examples. They are private, uncalibrated scores; absent evidence, ties, saturated retrieval and provider failures remain unknown.
- Automation, suspicious activity and identity matching remain separate. Reputation never establishes a user or person. An authorized agent may be automated and legitimate.

## Evidence

The extended browser profile enables aggregate movement/timing, runtime, permission, target/focus and bounded font probes. It retains no raw coordinates, actual keys, form content or browsing history and never reconstructs hidden browser values. Experimental probes are measurements, not validated detectors. Decoys remain a separate explicit experiment.

Server risk evidence may include bounded application counts, trusted edge metadata and optional IP reputation. AbuseIPDB uses its documented read-only check endpoint, a short timeout, bounded cache and request budget. No automatic reporting, no raw IP persistence, no raw IP sent to Jev, and no inference that a network listing makes an individual an attacker. The application explicitly supplies an IP obtained from a trusted connection/proxy path.

## Storage and operations

Reuse the current browser history, confirmed learning and evaluator-budget tables. One indexed browser-association table records explicit subject/account/actor relationships with expiry and erasure. Repeated authenticated observations update the same association. No scheduler, queue, shared learning network or model-training service is required.

Jev retains its documented typed interface. Risk-only evidence is excluded from every identity question. Failure returns unavailable assessment, not a claim of safety. Database failure remains a controlled response. Cached reputation evidence includes its source and age.

## Analytics and measurement

Server projections are event snapshots: browser, session, authenticated context, remembered/inferred status, candidate score, risk availability and reputation source. Inferred candidates never become SDK identify/alias calls. Standard funnels use authenticated identities; exploratory inferred funnels must group explicit candidate properties or warehouse views and keep their coverage/error rate visible.

No inferred number of operators is a verified human headcount. Existing optional operator studies can suggest profiles; verified users/credentials and estimates are reported separately. Model predictions do not become training labels.

## What is intentionally outside the default flow

The shared learning network, offline classifier training, provider-family research, custom delegations and warehouse-specific exporters remain advanced modules. The small integration does not start these services. This release does not claim calibrated cross-device probabilities, universal bot detection or hundreds of thousands of successful concurrent model evaluations.
