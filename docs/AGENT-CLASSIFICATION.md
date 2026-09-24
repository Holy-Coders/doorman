# Human, assistant and script scores

Doorman separates **who your app authenticated** from **what the current activity resembles**. A verified agent credential is an identity fact. A model's assistant score is an estimate. Neither is a verdict that the activity is abusive.

## Verified people and agents

Pass the actor your server authenticated through the normal endpoint:

```ts
const result = await doorman.assess(request, {
  auth: {
    userId: owner.id,
    accountId: workspace.id,
    actor: { id: authenticatedAgent.id, kind: "agent" },
  },
});
return result.response;
```

Your application must verify that credential and its permission to act for the owner. For a person acting as themselves, omit `actor`; the authenticated user is the actor. Count these verified IDs in [account reports](ANALYTICS.md), keeping browsers separate from people.

## Optional activity estimates

Enable [Jev](JEV.md) on your server and, if your collection policy permits, add extended browser summaries:

```ts
const doorman = createDoormanClient({
  endpoint: "/api/visitor",
  collection: "extended",
});
```

The recommended server API requests human, assistant and scripted-automation scores when enough aggregate evidence is present. No separate operator service, training dataset or classifier deployment is needed.

Read `result.identity?.operator` privately on the server:

| Field        | Meaning                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `status`     | `evaluated`, `insufficient-evidence`, `unavailable` or `disabled`.                         |
| `label`      | `human`, `assistant`, `automation` or `unknown`.                                           |
| `scores`     | Available human, assistant and automation estimates from 0 to 1. They need not sum to one. |
| `calibrated` | `false`: these are not measured real-world probabilities.                                  |

The label can remain unknown even after evaluation. Sparse input, weak scores and close alternatives should not force a label. Set `classifyOperator: false` on the TypeScript server to disable this optional classification.

The separate `risk.automation` and `risk.suspicious` scores describe technical automation and suspicious activity. A legitimate assistant can score highly on automation without being suspicious. [Server request aggregates](API-ACTIVITY.md) can add evidence of denied operations without claiming a person is an attacker.

## What you can report

Use `result.properties` with your existing server analytics events. Report evaluated activity by label, and show unknown/unavailable results separately. Keep that distinct from the number of authenticated agent credentials or users.

Doorman cannot reliably tell you that one shared password belongs to a husband and wife, count physical people, or identify ChatGPT versus Claude from mouse movement. Our recorded 80-session Jev study did not establish reliable human/agent separation. [Results and limitations](VALIDATION.md).

Missing mouse movement, privacy settings, software rendering, aligned clicks or a focus change are not proof of automation. Doorman respects hidden browser values and stores aggregate summaries rather than keys, forms or coordinate trails. See [optional signals](EXPERIMENTAL-DETECTION.md).
