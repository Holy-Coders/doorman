# Jev integration contract

Verified against official documentation on 2026-09-23:

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [TypeSafe Noul primitive](https://docs.typesafe.ai/primitives/noul)
- [Cloudflare Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- [Cloudflare input schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-input.json)
- [Cloudflare output schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-output.json)

Both transports share `createJevInput` and `parseJevResponse`. The full questions and state conversion are in [protocol.ts](../packages/evaluators/jev/src/protocol.ts). Three independent yes/no Noul judgments are batched in one request: `sameVisitor`, `automation`, `suspicious`. Noul probabilities are read from `noul`, not `score`, `value`, a generated JSON string, or a chat completion.

## Direct TypeSafe

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

## Cloudflare Workers AI

```ts
const response = await env.AI.run(
  "typesafe/jev",
  createJevInput({ history, current, deterministicSimilarity }),
);
```

The binding takes `{ state, questions }` directly. It requires no TypeSafe API key and does not receive a direct-API `model: 'jev-latest'` field. The official REST example instead uses `/ai/run` with `{ model: 'typesafe/jev', input: { state, questions } }`; that REST wrapper is **not** used with the binding.

The current model page is under `/ai/models/typesafe/jev/`, rather than the older guessed `/workers-ai/models/jev/` path. The invocation in the original product brief remains correct.

## Request and response shapes

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
