# Keep scores private

Doorman returns the visitor ID to the browser and keeps confidence, risk and account attribution on your server by default. This lets your application use an assessment without showing visitors the numbers they could try to manipulate.

Browser recognition is not authentication. A copied cookie or fabricated set of signals must not give someone access to an account.

## Read the full result on your server

Use `handle()` when you only need the endpoint response. Use `assess()` when your server needs the assessment too:

```ts
const { response, identity } = await visitor.assess(request);
if (!identity) return response; // A request-validation or storage error.

const needsExtraVerification =
  identity.riskStatus === "evaluated" && identity.risk.automation > 0.85;

// Your application can record this decision in its existing server session.
// Keep identity and the raw browser observation out of the public response.
return response;
```

The browser receives:

```json
{ "visitorId": "vis_…", "sessionId": "ses_…", "isReturning": true }
```

The example threshold is not a recommendation for production. Test the scores and false positives on your own traffic. Doorman never decides to block a request or show a CAPTCHA.

The same API works with Node, Vercel and Cloudflare. Native Phoenix puts the private result in `conn.assigns.doorman_identity`. `Doorman.handle` has already sent the measurement response when it returns, so use your own action handler for later access decisions.

## Distinguish zero risk from no assessment

Always read `riskStatus` alongside the numbers:

| Status        | Meaning                                                               | What to do                                                  |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `evaluated`   | The evaluator returned a valid result.                                | Treat the scores as estimates and apply your own policy.    |
| `disabled`    | No evaluator is configured.                                           | Use your existing controls; there is no AI risk assessment. |
| `unavailable` | Evaluation failed, timed out or was prevented by a configured budget. | Use the fallback your application has chosen.               |

For disabled or unavailable evaluation, both numeric risk values are zero. Those zeros do not certify safety. Browser matching can still succeed through the cookie or built-in similarity rules.

A storage failure produces a controlled `503` without a new cookie. Invalid requests receive an appropriate HTTP error. The browser client rejects failed identification, so catch that error if measurement should not interrupt navigation or login.

## Keep later actions tied to the right request

If checkout or another sensitive endpoint needs the assessment, store it in your existing server session with a short expiry and the operation it belongs to. Authenticate that endpoint normally and verify any CAPTCHA, passkey or MFA proof there.

Keep the assessment in your server session or database with a short expiry. Read it only after authenticating the action and checking that it belongs to the same context. Browser continuity never replaces permission checks.

## Avoid leaking scores through another route

Keep private assessments out of browser JSON, HTML props, client logs, URLs and browser analytics calls. A signed but unencrypted JWT can still be read by its holder; signing alone does not hide a score.

Use the [server analytics integration](ANALYTICS.md) for PostHog, Mixpanel or Segment risk events. The browser analytics helper accepts user identity updates, not private scores.

The recommended `createDoorman` flow keeps scores and debug observations private. Do not serialize the full private result into a browser response.

## Limit measurement work

The TypeScript handler limits concurrent measurements per instance. Default database-backed protection adds request quotas, AI call budgets and temporary pauses after repeated provider failures. See [request limits and trusted events](HARDENING.md).

These controls protect measurement resources. Your gateway and application still need their normal limits for login, payments and network traffic. Use account/session keys verified by your server rather than identifiers supplied in arbitrary headers or browser JSON.

If a trusted edge provider supplies a bot assessment, pass it only through a verified server path. Doorman does not infer trust from `X-Forwarded-For` or client-supplied bot-score headers. It does not collect raw IP addresses.

## Understand the remaining limits

- A matching browser can be used by another person, an agent or an attacker.
- An agent credential identifies an agent; it does not grant permission to use a user’s account. Your application must verify the permission to act for that user.
- Client measurements and cookies can be copied. History protection reduces some poisoning attempts but cannot make those inputs unforgeable.
- Typed AI output can still be wrong. Treat it as one input to policy rather than a replacement for authentication.

The repository tests response privacy, tampering, expiry, replay, conflicting identities and provider failures. These are engineering checks, not an independent security audit or a measured account-takeover detection rate. See [testing and limitations](VALIDATION.md) and [OWASP’s automated-threat guidance](https://owasp.org/www-project-automated-threats-to-web-applications/).
