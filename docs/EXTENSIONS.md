# Behavior and cross-device links

Doorman’s default browser client counts events such as mouse moves and key presses. You can optionally collect more detailed totals to give the risk evaluator additional context. This page also shows the simplest way to label several signed-in browsers with the same account ID.

If you need verified email keys or agent permissions as well, use the [identity directory](AGENTIC-IDENTITY.md). The lightweight account labels below are a separate option that requires no account tables.

## Optional motion and timing summaries

```ts
import { createVisitorClient } from "@aarondovturkel/doorman-browser";

const visitor = createVisitorClient({
  endpoint: "/api/visitor",
  behavior: "extended",
});
const identity = await visitor.identify();
```

The default is `behavior: "counts"`. Extended mode adds mouse travel, active movement time, direction changes, pauses, vertical wheel travel/reversals, and aggregate press-interval statistics. It keeps constant memory and sends rounded totals only. No absolute pointer coordinates, event sequences, actual keys, text, form contents or passwords are read or retained. See [the complete inventory](../PRIVACY.md).

Use compatible client and server versions: the server rejects measurement fields it does not recognize. With Jev disabled or unavailable, risk remains zero even if webdriver is true or motion looks automated. With Jev enabled, these measurements become additional uncalibrated evidence, not a reliable bot verdict. Humans using assistive technology and bots driving native browsers can produce similar events. Input data can be spoofed.

## One account, multiple devices

Use the application's existing verified authentication. Doorman does not implement login or infer an account from anonymous fingerprints.

```ts
import { createVercelVisitor } from "@aarondovturkel/doorman-adapters/vercel";

const visitor = createVercelVisitor({
  db,
  evaluator: false,
  subjectLinking: {
    secret: process.env.DOORMAN_SUBJECT_SECRET!,
    namespace: "my-app-production",
  },
});

export async function POST(request: Request) {
  const session = await auth(); // Your existing, server-verified authentication.
  return visitor.handle(request, {
    authenticatedSubject: session?.user?.id,
  });
}
```

Cloudflare and Node adapters expose the same options and handler context. In a multi-tenant application, pass a collision-safe tenant/account pair, such as `JSON.stringify([session.tenantId, session.user.id])`, derived entirely from the verified session. Never forward an unverified body field, email string, user-ID header or user-supplied cookie as `authenticatedSubject`.

Generate the secret once with `openssl rand -hex 32` and store it in server-side secret configuration. Share it across instances of the same application. Do not expose it in a browser bundle. Different application namespaces produce different labels even if the secret is reused; separate secrets are preferable.

A laptop and phone signed into the same account produce these **private server results**. Access them through the `identity` returned by `await visitor.assess(request, context)`; `handle()` does not expose `subjectId` to the browser by default:

```json
{ "visitorId": "vis_laptop…", "subjectId": "sub_same-account…", "isReturning": true }
{ "visitorId": "vis_phone…",  "subjectId": "sub_same-account…", "isReturning": false }
```

The shortened IDs and omitted risk/confidence fields above are illustrative. The browser ID remains distinct; `isReturning` and `confidence` describe browser continuity, not prior account login. The account label is HMAC-SHA-256 over a versioned namespace/account tuple. Its derivation does not use device signals, and the account identifier never reaches Jev or fingerprint storage.

On logout, omit `authenticatedSubject`; the private result no longer contains `subjectId`, even when the browser cookie remains. Signing in as a different account returns a different subject. Shared accounts, stolen credentials and account takeovers require the application's own authentication/security controls. A subject label is not an authentication token.

This stateless `subjectLinking` option stores no account graph and needs no new database tables. Your application may store associations using its existing account model and should erase them with that account. Secret/namespace rotation changes all labels. Account-specific generation IDs can invalidate one account's prior derived label. For anonymous cross-device pairing, the application must first verify a pairing flow and pass the resulting stable subject identifier; Doorman does not implement that verification.

## Anonymous sessions and later logins

The optional [learning collector](LEARNING.md) uses the identity directory and a separate short session cookie to label pre-login snapshots from a verified login. It is disabled by default, supports application-wide or per-request collection permission, and stores data on the implementer's server. It includes no automatically trained cross-device classifier. Optional predictions run in shadow mode and never become verified account links.

## Configurable scoring and activity features

See [scoring configuration](SCORING.md) for server-side identity weights and operator thresholds, and [agent classification](AGENT-CLASSIFICATION.md) for optional aggregate movement/timing evidence. These are current TypeScript source features; defaults and private-score behavior are retained.
