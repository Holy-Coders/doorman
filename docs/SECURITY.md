# Private scores and server-side decisions

Janitor keeps scores on the implementer's server by default. Browser identity is context, never an account credential. A copied cookie or fabricated fingerprint must not grant access to another person's account.

## Public response versus private evidence

`handle(request)` responds with only:

```json
{ "visitorId": "vis_…", "isReturning": true }
```

`assess(request, context)` runs the same validation, matching, persistence and cookie handling, but also returns a private `identity` to server code:

```ts
const { response, identity } = await visitor.assess(request);
if (!identity) return response; // Controlled HTTP validation/storage error.

// Server-only evidence for your application policy or server analytics.
const automation = identity.risk.automation;
const evaluated = identity.riskStatus === "evaluated";
// Persist what your policy needs in your existing short-lived server session.
// Never return identity, put it in page props, or log the full observation.
return response; // Scores, account/actor attribution and debug are omitted.
```

This works with Node, Vercel and Cloudflare adapters. The core `engine.identify()` always returns the full server result. Phoenix `Janitor.handle` stores it in `conn.assigns.janitor_identity` while sending the minimal body; use `Janitor.identify` directly for an application-owned action flow, with your existing request validation, session and CSRF boundary. The Plug response has already been sent when `handle` returns: perform access decisions before sending your action response, not after this measurement endpoint.

A deliberate `exposeClientScores: true` (`expose_client_scores: true` in Elixir) restores the full public result, including any configured account attribution. This is a disclosure opt-in, not an authentication feature. Normal production integrations should leave it off. Browser query parameters, headers and payload fields cannot enable it. Debug still additionally requires non-production server configuration and a debug request. Even configured debug stays private unless public scores are enabled. The browser SDK accepts either response, with optional score fields in `VisitorClientIdentity`.

## Avoid a feedback oracle

Returning a number on every probe lets an attacker search for inputs that lower it. Hiding the DOM is insufficient: JSON, headers, hydration props, analytics requests, browser logs and base64-encoded JWT claims are visible. Send risk events through **server** PostHog/Mixpanel/Segment integrations. Do not send a private score to a browser analytics SDK just because it is absent from the UI.

If a later action needs an assessment, keep it in the existing server session or transport it with an encrypted result receipt. `createResultReceipts` uses `jose` JWE with `dir` / `A256GCM`, a dedicated **32-byte random key**, protected type, expiry, audience, operation, action and a one-use nonce. The browser cannot read the evidence in the token. The application must bind the operation to its authenticated account and immutable action details and consume nonces atomically. See [receipts](TRUST.md). v0.5 plaintext signed receipts are intentionally rejected; outstanding receipts expire within five minutes. Reissue with v0.6 and update keys if necessary.

Encryption protects token contents and integrity. It does not attest browser measurements, prove human presence, stop a stolen token from being attempted once, or replace authorization. Avoid placing tokens in URLs or logs. Response sizes, timing, continuity IDs and eventual allow/challenge outcomes still reveal information; this release does not claim to eliminate side channels. Janitor is open source: deterministic rules and weights are public, so keeping a response private does not make the matching algorithm secret.

## Protect the actual action

The browser may render an application-selected CAPTCHA or step-up flow. Your server must verify its proof against the correct session/action before executing the operation. A client flag such as `captchaPassed: true`, a low browser-submitted score or a matching visitor ID must never be sufficient. Janitor returns evidence and does not make the access decision.

Use existing gateway/application controls for request limits, body limits, account/session/action velocity, request concurrency and inference budgets. Janitor bounds work **per request**, not requests per attacker. Do not key a rate limit solely by spoofable client headers or an attacker-controlled visitor ID. No built-in global rate limiter is claimed.

Only accept edge assessments from a trusted provider binding or authenticated origin path. Ignore arbitrary `X-Forwarded-For`, bot-score or JA4 headers sent directly to an origin. Network similarity can corroborate evidence; shared NAT, corporate proxies, VPNs and privacy tools are not proof of abuse. Janitor does not currently collect IP addresses or implement JA4/IP reputation.

Keep account and actor identities separate. A verified agent vendor is not permission to use a particular user's account; require the user's scoped, expiring, revocable delegation. A family member needs their own authenticated actor context. An anonymous fingerprint cannot determine whether the operator is the owner, their relative, or an attacker.

## Focused review findings — 2026-09-23

This is a focused engineering review, not an independent audit or penetration test.

| ID     | Severity                                  | Finding and status                                                                                                                                                                                                                          |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01 | High for a fraud integration              | HTTP responses previously exposed risk/confidence for every probe. Fixed: allowlisted minimal default; private `assess()` and Phoenix assigns; explicit server disclosure option.                                                           |
| SEC-02 | High when receipts pass through a browser | Signed receipts carried readable scores. Fixed: authenticated encrypted JWE; strict algorithm/type checks; legacy plaintext rejection.                                                                                                      |
| SEC-03 | High if misused for authorization         | Cookies and browser observations remain copyable. Existing authentication, action binding and one-time nonce consumption are mandatory in protected app flows. Janitor does not manufacture authentication from similarity.                 |
| SEC-04 | Medium operational                        | Anonymous callers can generate many bounded requests and AI calls. Gateway/account/session limits and provider budgets remain implementer responsibilities; fleet-wide throttling is not implemented.                                       |
| SEC-05 | Medium data quality                       | Crowded lookup buckets can hide competing identities. Fixed: selective indexes, ranking before truncation, and abstention when every bucket containing the selected visitor is saturated. Similarity still requires real-world calibration. |

Evidence: [HTTP disclosure boundary](../packages/adapters/src/handler.ts#L212), [private assessment](../packages/adapters/src/handler.ts#L239), [receipt encryption](../packages/adapters/src/security.ts#L64), [strict receipt decryption](../packages/adapters/src/security.ts#L92), [native Plug boundary](../packages/elixir/lib/janitor/plug.ex#L78), [saturated lookup guard](../packages/core/src/candidates.ts#L35), [security regressions](../tests/extensions.test.ts), [response regressions](../tests/adapters.test.ts), [crowded database regressions](../tests/storage.test.ts).

References: [OWASP automated threats](https://owasp.org/www-project-automated-threats-to-web-applications/), [jose encrypted JWTs](https://github.com/panva/jose/blob/main/docs/jwt/encrypt/classes/EncryptJWT.md), [Fingerprint client-tampering guidance](https://docs.fingerprint.com/docs/protecting-from-client-side-tampering), and the [research review](RESEARCH.md).
