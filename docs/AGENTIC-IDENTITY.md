# Humans, agents & authority

Janitor provides **identity context for the agentic era**: browser continuity, verified account and actor references, explicit delegation, and Jev risk scores. It is a small library that runs with your database and authentication system. It never grants access or automatically blocks a request.

## Separate questions, separate evidence

| Question                                | Evidence                                                          | Janitor result                                        |
| --------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Which browser environment is this?      | First-party cookie and bounded observation history                | `visitorId`, `confidence`, `isReturning`              |
| Which account is authenticated?         | Your server-verified account context                              | `attribution.subject`                                 |
| Who or what is acting?                  | A separately authenticated person or agent principal              | `attribution.actor`                                   |
| May this actor act for this account?    | Stored delegation, actor, audience, scopes, expiry and revocation | `attribution.delegation`; application enforces access |
| Does the environment warrant attention? | Available technical signals and aggregate behavior                | Jev `risk.automation` and `risk.suspicious`           |

An authorized assistant can have high automation and valid delegation. An intruder using a stolen session can have a familiar fingerprint. A person can use an agent for part of a session and continue manually afterward.

`confidence` measures browser continuity, not the likelihood that a particular human is at the keyboard. Verified credentials have explicit provenance, not a fabricated probability. Unknown actors stay unknown. Risk defaults to zero if evaluation fails; zero is not evidence of safety.

## Configure the identity directory

Apply both `0001_visitors.sql` and `0002_identity.sql` from your storage package. The example migration commands also apply `0003_learning.sql`; learning remains disabled unless explicitly configured. Add a secret and namespace to any high-level adapter:

```ts
import { createNodeVisitor } from "@janitor/adapters/node";

const janitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  identity: {
    secret: process.env.JANITOR_IDENTITY_SECRET!,
    namespace: "my-app-production",
  },
});
const identities = janitor.identities!;
```

Cloudflare and Vercel accept the same `identity` option. Generate the secret with `openssl rand -hex 32`. Share it across application instances; keep it out of browser bundles. A namespace and secret define the identity/key lookup scope. Isolate applications in separate databases or schemas. Changing the secret or namespace changes derived IDs and key digests and requires a deliberate data migration; old records are not automatically relabeled.

## Update subjects and verified email/key associations

These are **server-only management methods**. Authenticate and authorize the caller before calling them. Janitor does not send verification emails, run OAuth, verify public-key signatures, or provide login endpoints.

```ts
// Run after your authentication provider verifies this account.
const owner = await identities.updateSubject({
  id: verifiedAccount.id, // Immutable application ID, not an email address.
  kind: "person",
});

// Run after your application's verification flow proves email ownership.
await identities.addVerifiedKey(owner.id, {
  type: "email",
  issuer: "my-app",
  value: verifiedAccount.email,
});

const match = await identities.findSubject({
  type: "email",
  issuer: "my-app",
  value: verifiedAccount.email,
});
```

Key types are `email`, `external`, and `public-key`. For a public key, pass a canonical fingerprint or credential reference, never a private key or API secret. External keys should include an issuer, such as your authentication provider. The directory stores an application-scoped HMAC digest, key type, issuer and association time; it does not store the raw value. Neither the raw account ID nor identity keys are sent to Jev.

Email domain case is normalized; local-part case, plus addressing, and dots are preserved. Use the same verified canonical representation on every call. `findSubject` performs a lookup, **not authentication**: knowing an email or key reference does not prove ownership.

Subject updates are idempotent, and a subject's `kind` cannot change. A key belongs to at most one subject in the directory. A conflicting assignment fails atomically, including concurrent writes; Janitor never merges accounts based on a matching email or browser fingerprint. Each management call commits independently.

For an email change, verify and add the new key, then remove the old one:

```ts
await identities.removeKey(owner.id, {
  type: "email",
  issuer: "my-app",
  value: previousVerifiedEmail,
});
```

An address can change owners. Your authentication system owns verification, account recovery, key lifecycle, and account merges. Revoke an old association when its ownership changes. The stored `verifiedAt` is the time your server registered the verified association, not an independent verification performed by Janitor.

## Register an agent and delegate explicitly

An agent is a separate principal with its own credential. After the account owner authorizes a grant:

```ts
const assistant = await identities.updateSubject({
  id: verifiedAgentCredential.subject,
  kind: "agent",
});
const grant = await identities.createDelegation({
  principalId: owner.id,
  actorId: assistant.id,
  audience: "calendar-api",
  scopes: ["events:read"],
  expiresAt: Date.now() + 60 * 60 * 1000,
});
```

Grants expire within 30 days, have at most 32 exact-match scopes, and are revocable. A grant ID is a database reference, **not a bearer credential**. Janitor does not mint agent authentication tokens. The application must authenticate the actor separately and authorize grant creation. Delegation is one hop; there is no implicit grant chaining or wildcard scope expansion.

At the request boundary, derive context from server-verified credentials and the target action:

```ts
return janitor.handle(request, {
  verified: {
    subjectId: owner.id,
    actorId: assistant.id,
    delegationId: grant.id,
    audience: "calendar-api",
    requiredScopes: ["events:read"],
  },
});
```

Never copy these fields from an unverified request body, headers, or a client claim saying `onBehalfOf`. Audience and required scopes must come from the target endpoint/action. Without `requiredScopes`, assessment checks grant validity but makes no claim about an action's scope. A valid grant does not establish that every action is benign.

The additional response field looks like this (IDs are shortened for illustration):

```json
{
  "attribution": {
    "subject": { "id": "sub_account…", "status": "verified" },
    "actor": {
      "id": "sub_assistant…",
      "kind": "agent",
      "basis": "verified-credential"
    },
    "delegation": {
      "id": "dlg_grant…",
      "status": "valid",
      "scopes": ["events:read"],
      "expiresAt": 1791000000000
    }
  }
}
```

An expired, revoked, missing, or mismatched grant returns `status: "invalid"` with a narrow reason. `handle` still returns identity/risk information; the application must enforce its own access policy. Never treat the assessment endpoint as a permission check that enforces access by itself.

For a server agent without a browser, use `identities.assess(verifiedContext)` directly. It returns attribution only. No browser history or risk score is manufactured. Database errors throw from management/assessment methods; the HTTP handler returns a controlled 503 and does not manufacture valid identity context.

```ts
await identities.revokeDelegation(grant.id);
const assessment = await identities.assess(verifiedContext);
// The application checks assessment.delegation and applies its own policy.
```

Assessment is a point-in-time read, not a reservation or atomic authorization transaction with your application's later action. Recheck delegation for privileged actions and coordinate sensitive operations with your authorization system.

## Family members and unknown actors

Register a family member as a separate `person` subject and issue a limited delegation for the shared account. Authenticate that member's credential and pass their ID as `actorId`. No biometric or behavioral guess is required.

`actor.kind: "person"` means the authenticated credential is associated with a registered person principal. It does not prove live human operation; an agent or attacker may control that credential. If everyone shares one login, Janitor cannot reliably distinguish the people at the keyboard. If `actorId` is omitted, the actor is `unknown`, even when the account is verified.

A subject may also be an agent account in its own right. Self-operated sessions can pass the same verified subject and actor ID without a delegation. That describes identity; it does not grant application permissions. Creating a delegation to oneself is rejected.

Treat possible account takeover as a reason to gather stronger evidence: reauthentication, credential verification, or user confirmation according to application policy. “Hacker” is not an identity class that browser observations can establish.

## Where Jev fits

Jev evaluates state against narrow questions and returns bounded typed answers. Janitor asks `sameVisitor`, `automation`, and `suspicious`. Deterministic evidence constrains browser identity restoration. Identity-directory records, email addresses, keys, and grants are not sent to Jev.

Keep credential evidence, inferred scores, and authorization results separate. Cryptographic validation stays in the authentication layer; grant scope/expiry/revocation checks are deterministic. A classifier cannot override them. Janitor's scores still need calibration against labeled data from the deploying application; typed output does not guarantee a correct judgment.

TypeSafe introduced Jev as a structured decision model on September 15, 2026. LangChain's September 17 agent-harness article demonstrates the broader integration pattern. These sources explain the model category; they are not endorsements or measurements of Janitor.

- [TypeSafe: Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [LangChain: Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev)

## Erasure, retention, and validation

`identities.deleteSubject(subjectId)` deletes its identity keys and all grants involving that subject through foreign-key cascades. Browser histories remain separate: use `deleteVisitor(visitorId)` for those and erase associations held by your application. Deletion does not revoke credentials in your authentication provider. Re-registering the same external ID with the same secret/namespace derives the same opaque ID; use an account-generation component if recreation must have a new identity.

`janitor.cleanup()` prunes browser history and expired grants. Subject/key records remain until explicitly removed. Do not store identity associations longer than your application's account and credential lifecycle requires.

The real D1 and Postgres tests exercise conflicts, erasure, invalid scopes/audiences/actors, expiry, revocation, family-member delegation, unknown actors, and the HTTP trust boundary. The [browser benchmark](BENCHMARKS.md) measures controlled browser continuity. Neither test suite establishes account-takeover detection accuracy or Jev risk calibration; that requires a consented, labeled pilot in a real application.
