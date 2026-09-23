# Signed credentials, actions and device pairing

Janitor separates browser continuity from authenticated accounts, actors and grants. Scores cannot establish that an account is being used by its owner, a family member or an attacker. Explicit credentials and delegation provide stronger evidence; the application authorizes every action.

## Verify an agent's existing credential

`@janitor/adapters/security` uses the maintained `jose` implementation for JWT verification. Pin the issuer, audience, accepted asymmetric algorithms and trusted public key/JWKS URL. Never use a token's `jku`/`x5u` header or an unverified issuer to choose where to fetch keys.

```ts
import { createRemoteJWKSet } from "jose";
import { verifyAgentCredential } from "@janitor/adapters/security";

// From your chosen issuer's configuration/documentation, not request input.
const keys = createRemoteJWKSet(new URL(process.env.AGENT_JWKS_URL!), {
  timeoutDuration: 1000,
});
const credential = await verifyAgentCredential(bearerToken, {
  key: keys,
  issuer: process.env.AGENT_ISSUER!,
  audience: "my-app",
  algorithms: ["ES256"],
  // Use your issuer's documented agent/service-account claim semantics.
  isAgent: (claims) => claims.actor_type === "agent",
});
if (!credential) return new Response("Invalid credential", { status: 401 });
const actor = await visitor.identities!.updateSubject({
  id: JSON.stringify([credential.issuer, credential.subject]),
  kind: "agent",
});
```

`actor_type` above is an example for your issuer, not a universal provider claim. Standard expiry, issued-at, issuer, audience and signature checks are required. A bearer credential does not prove possession of a signing key on this particular request; handle provider revocation and replay policy in your existing authentication. This is not a Web Bot Auth implementation or universal agent-vendor detector.

A recognized agent is not automatically authorized by a user. Retrieve the independently authenticated principal and previously authorized delegation, then call `identities.assess({ subjectId, actorId: actor.id, delegationId, audience, requiredScopes })`. Check revocation, scope and audience on every sensitive operation. Do not accept a principal/account claim solely because a recognized agent supplied it. Native Phoenix can use an existing verified Guardian/Joken/OAuth credential and pass the resulting actor to `Janitor.Identity.assess/2`; it does not need the TypeScript JWT helper.

## Short-lived result receipts

Use receipts when a subsequent operation must consume a result computed on your server. They sign selected evidence, not the truth of browser measurements. They omit debug and fingerprint data. Always retain normal authentication and verify that the operation belongs to the authenticated account.

```ts
import { createResultReceipts } from "@janitor/adapters/security";

const receipts = createResultReceipts({
  secret: receiptSecretBytes, // At least 32 cryptographically random bytes, server-only.
  issuer: "my-app-production",
});
const token = await receipts.issue({
  identity, // From your server engine, never a browser-submitted result.
  audience: "checkout",
  operationId: checkout.id, // Server-generated, bound to account and immutable request details.
  action: "payment", // sign-in | payment | profile-update | read | other
  ttlSeconds: 60, // Maximum 300 seconds.
});

const evidence = await receipts.verify(token, {
  audience: "checkout",
  operationId: checkout.id,
  action: "payment",
  consumeNonce: async (nonce, expiresAt) => {
    // Atomically INSERT into your app table with UNIQUE/PRIMARY KEY(nonce).
    // Return true for one inserted row; false for an existing nonce.
    return appConsumeNonce(nonce, expiresAt);
  },
});
```

`appConsumeNonce` is application code, not a Janitor API. A Postgres implementation can use `INSERT ... ON CONFLICT DO NOTHING RETURNING nonce` in your operation transaction. Bind `operationId` to the authenticated account, immutable amount/destination/request hash and idempotency state; do not choose it from an unchecked header. A mismatch, expired token, tampering, replay or nonce-store failure returns `undefined`. Only a fully verified receipt invokes nonce consumption. Treat failed downstream operations as a separate idempotency/retry decision. Clean expired nonces with existing maintenance. Never use a per-process Set as production replay protection.

Action categories are supplied by server code and bound to the receipt; they do not alter identity matching or automatically label an action malicious. Current risk questions remain technical browser questions. Keep receipts out of URLs/logs. JWTs are signed, not encrypted. Use distinct keys per environment/purpose; rotation invalidates outstanding receipts, which expire within five minutes. Both holders of an HMAC secret can sign; use an existing asymmetric token service if verifiers must not issue.

## Explicit cross-device pairing

Use the application's existing passkey/OAuth login or authenticated device-approval flow. The smallest implementation needs no new Janitor token protocol:

1. Device A requests an application-generated, short-lived pairing challenge while authenticated.
2. Device B scans the link and authenticates with the same application. The app verifies challenge possession, account equality, expiry and one-time use, and asks for explicit approval as appropriate.
3. Each device's authenticated route calls `updateSubject({ id: account.id, kind: "person" })` (Elixir: `identify_user`). Both derive the same account subject, while preserving distinct `visitorId` values.
4. The app stores its revocable device grant and verifies it on subsequent requests before supplying Janitor's trusted context. Removing the grant stops account attribution for that device; browser continuity alone never reinstates it.

Do not grant account access merely because a device received a QR link, resembles another browser, or scores highly with Jev. If your application already has device pairing or passkeys, these are the Janitor integration points rather than a second authentication system.

Implementation reference: [jose verification and signing](https://github.com/panva/jose). These checks have deterministic tests for signature, audience, action, operation, replay and expiry. They do not prove human presence or calibrate risk.
