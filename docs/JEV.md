# Jev & risk scoring

Jev is an AI model from TypeSafe that answers structured questions. Janitor uses it as an optional second opinion on browser history and as a source of technical risk estimates. You do not need Jev to assign visitor IDs or match browsers with the built-in comparison rules.

## Where Jev participates

| Stage                          | What Jev evaluates                                                                   | Bound                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Before a missing-cookie lookup | Whether graphics and locale signals are useful for specific indexed query families.  | One call; fixed query choices, no generated SQL.                      |
| Browser matching and risk      | Every plausible candidate's history, plus current automation and suspicious signals. | One call for up to ten candidates, with up to five observations each. |
| Optional cross-device learning | Whether the current session fits a person’s separately login-confirmed sessions.     | One call for up to ten people, three examples each.                   |

Cookie visits skip lookup planning and global candidate search. Set `lookupPlanning: false` (`lookup_planning: false` in Elixir) to skip the planning call while retaining batch matching. If a restricted lookup finds nothing, Janitor retries the standard indexed lookup. If the planner fails, it uses the standard lookup immediately.

Turn on [learning](LEARNING.md) to use the built-in cross-device predictor. No custom callback is needed. It starts suggesting after confirmed history exists and abstains when evidence is missing, crowded or ambiguous. It never turns a prediction into a verified login or an analytics profile merge.

## What the three scores mean

| Score         | Question Janitor asks                                                    | How Janitor uses it                                                       |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `sameVisitor` | Does this browser fit its recent history, allowing for ordinary changes? | Combines it with the built-in similarity score when recovering a lost ID. |
| `automation`  | How consistent are the available signals with browser automation?        | Returns it privately to your server. It never changes identity matching.  |
| `suspicious`  | Are the technical signals inconsistent or unusual?                       | Returns it privately to your server for your own policy.                  |

Each score is between 0 and 1. A high automation score is not a verdict that a visitor is malicious: an authorized assistant may be automated. Missing mouse movement, unavailable browser APIs and privacy settings are not, by themselves, evidence of abuse.

The scores are estimates that need testing on your traffic. There is no universal safe CAPTCHA threshold. Read [how to use private assessments](SECURITY.md) before connecting a score to an action.

## Turn Jev on

For Node or Vercel, give the adapter your TypeSafe API key:

```ts
const visitor = createNodeVisitor({
  db,
  evaluator: { apiKey: process.env.JEV_API_KEY! },
  evaluatorTimeoutMs: 1200,
});
```

For Cloudflare, supply your Workers AI binding:

```ts
const visitor = createCloudflareVisitor({
  db: env.VISITORS,
  ai: env.AI,
  evaluatorTimeoutMs: 1200,
});
```

The Cloudflare binding needs no separate TypeSafe key. For native Elixir, use `evaluator: [api_key: System.fetch_env!("JEV_API_KEY")]` in `Janitor.new`. Keep credentials on the server. Provider calls may incur charges: a missing-cookie request normally makes one planning call and one matching/risk call; learning can add one more. A known cookie needs one risk call, plus learning when enabled. Configure a shared [inference budget](HARDENING.md) for all stages.

## Data sent to the model

For browser matching, Janitor sends a compact current observation and up to five historical observations for each of at most ten candidates. Learning sends at most three confirmed examples for each of ten people. Requests exceeding 64 KiB are declined locally and fall back. Account IDs, email keys, permissions and trusted server evidence are not sent to Jev. The model sees browser-signal strings as untrusted input rather than instructions.

Janitor keeps the final matching decision in code. Sparse or contradictory evidence can cap the result even when Jev returns a high score. See [matching rules](MATCHING.md).

## When evaluation fails

Timeouts, rate limits, network errors and malformed answers do not stop browser identification. Janitor falls back to its built-in matching rules and returns zero risk with `riskStatus: "unavailable"`. With no evaluator configured, the status is `"disabled"`.

Always read the status before using a score. An unavailable zero means “not assessed.” The library does not automatically retry or block anyone.

The direct API request can be aborted. A Workers AI timeout stops Janitor waiting, but the provider call may still complete and incur usage. Use [request and inference limits](HARDENING.md) if needed.

## Provider API reference

The following details are for people replacing or inspecting the evaluator. Normal integrations only need the adapter configuration above.

Both implementations use TypeSafe's **Noul** question type: a yes/no judgment expressed as a number from 0 to 1. Janitor batches related questions in one request and reads each answer's `noul` field. The single-history method asks three questions; batch matching asks `candidate0` through `candidate9` as needed, plus `automation` and `suspicious`. Lookup uses `graphics` and `locale`; learning uses `person0` through `person9`. The exact questions are in [protocol.ts](../packages/evaluators/jev/src/protocol.ts) and [intelligence.ts](../packages/evaluators/jev/src/intelligence.ts).

Verified against the official [TypeSafe API](https://docs.typesafe.ai/api), [Noul documentation](https://docs.typesafe.ai/primitives/noul) and [Cloudflare Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/) on September 23, 2026.

### Direct TypeSafe

```ts
const response = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "jev-latest",
    ...createJevInput({ history, current, deterministicSimilarity }),
  }),
  signal: AbortSignal.timeout(timeoutMs),
});
```

The model alias is configurable. `JEV_API_KEY` is an application/example environment variable; the library receives `apiKey` explicitly. There is no SDK, retry dependency, or environment lookup inside the library.

### Cloudflare Workers AI

```ts
const response = await env.AI.run(
  "typesafe/jev",
  createJevInput({ history, current, deterministicSimilarity }),
);
```

The binding takes `{ state, questions }` directly. It requires no TypeSafe API key and does not receive a direct-API `model: 'jev-latest'` field. The official REST example instead uses `/ai/run` with `{ model: 'typesafe/jev', input: { state, questions } }`; that REST wrapper is **not** used with the binding.

### Request and response shapes

```ts
{
  state: {
    history: [
      { platform: 'ios', browser: 'safari', timezone: 'Asia/Jerusalem', screen: '390x844', hardwareConcurrency: 6 }
    ],
    current: { /* compact signals and aggregate behavior */ },
    deterministicSimilarity: 0.94,
    evidence: [ /* transparent per-snapshot similarity feature values */ ]
  },
  questions: {
    sameVisitor: { type: 'noul', instructions: '…', criteria: { true: '…', false: '…' } },
    automation: { type: 'noul', instructions: '…', criteria: { true: '…', false: '…' } },
    suspicious: { type: 'noul', instructions: '…', criteria: { true: '…', false: '…' } }
  }
}
```

Documented response shape (illustrative values):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "sameVisitor": { "type": "noul", "noul": 0.98 },
    "automation": { "type": "noul", "noul": 0.12 },
    "suspicious": { "type": "noul", "noul": 0.08 }
  },
  "usage": { "input_tokens": 500, "output_tokens": 40 }
}
```

The parser requires all three Noul types and finite numbers within `[0,1]`; it does not coerce strings, clamp invalid outputs, or parse prose. Unknown envelopes are treated as unavailable evaluation and fail open in core. Model metadata/usage is not used as identity confidence. Responses are mocked in the test suite; no paid direct Jev or Workers AI inference has been performed as part of repository validation.

Question instructions explicitly treat signal strings as untrusted data. They allow ordinary drift and privacy restrictions, forbid inferring automation from missing mouse movement/APIs alone, and restrict risk to current observations. All identity decisions, thresholds, contradiction guards and persistence remain deterministic code.
