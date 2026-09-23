# Run the learning service on Cloudflare

This is a separate, authenticated pilot service. Installing Janitor does not enroll an application or enable uploads. D1 stores bounded summaries, feedback, evaluation leases and model reports. Workers AI is optional and spending starts disabled.

From the repository root:

```sh
pnpm install
pnpm build
cd examples/learning-worker
pnpm migrate:local
```

Generate a random operator token locally. Keep the token in your password manager. Put only its SHA-256 digest in `.dev.vars` as `OPERATOR_KEY_HASH`. The operator API can issue participant credentials and promote models; never put this token in a browser or a customer integration. `.dev.vars` is ignored by Git.

```sh
pnpm dev
```

`GET http://localhost:8787/health` returns the service protocol version. Everything under `/v1/` requires a participant bearer key. `/operator/` requires the distinct operator bearer key and `Content-Type: application/json`.

## Enroll a pilot application

Call `POST /operator/tenants` with `{"trainingApproved":true,"retentionDays":30}`. The response contains `tenantId` and a newly generated `apiKey`. Deliver that key privately to the application operator. No preference is enabled automatically, including when training is approved. Leave `trainingApproved` false for participants that have not been reviewed for the training pilot.

The application separately calls `POST /v1/preferences` with its chosen `evaluation`, `contribution` and `training` booleans. See [the client guide](../../docs/NETWORK-CLIENT.md). Registration approves that implementer to attest to its own reviews and credential verification; it does not verify those outcomes centrally.

To revoke a participant credential, `POST /operator/revoke` with `{"tenantId":"tenant_..."}`. This deletes its contributed samples/labels, invalidates affected model evidence and prevents new authenticated requests. Stop/coordinate in-flight requests too. Issue a new participant credential if it needs to re-enroll. Never share an operator token with a participant.

## Discover and review patterns

Reserve at least three participant applications for holdout **before looking at their outcomes**. Also use at least three separate training participants. Configure their holdout tenant IDs in `DISCOVERY_HOLDOUT_TENANTS`. The daily scheduled handler uses a 14-day training cutoff and a 7-day validation cutoff, creates separate assistant/abuse reports and leaves them in shadow mode. With the default empty holdout list, only cleanup runs.

For a manual, reviewable report, `POST /operator/discover`:

```json
{
  "target": "assistant",
  "trainingBefore": 1790000000000,
  "validationBefore": 1790600000000,
  "holdoutTenants": ["tenant_...", "tenant_...", "tenant_..."]
}
```

Replace the illustrative timestamps and IDs with your preselected split. The response includes the model ID, learned conditions, sample counts, validation/test statistics and failed gates. The service never offers tenant keys an endpoint for reading another application's observations.

`POST /operator/promote` with `{"modelId":"model_...","canaryPercent":1}` requires all gates to pass and unexpired, unrevoked evidence. `POST /operator/rollback` with `{"modelId":"model_..."}` retires it. Promotion changes the supporting evidence supplied to Jev; application policy and authorization remain unchanged. Review later outcomes before increasing the percentage.

## Deploy your own instance

Create your own D1 database and put its ID in a copy of `wrangler.jsonc`; do not use the repository's hosted pilot database ID for another application. Then:

```sh
pnpm exec wrangler d1 create my-janitor-network
pnpm migrate:remote
pnpm exec wrangler secret put OPERATOR_KEY_HASH
pnpm run deploy
```

Set a unique Worker name and your own binding/database name as well. The checked-in deployment has no automatic participant enrollment and no automatic contribution from the Janitor website.

To deliberately enable paid inference, set `JEV_ENABLED` to `"true"` and configure positive `MAX_EVALUATIONS_PER_DAY` and `MAX_EVALUATIONS_LIFETIME` caps. Reservations are persisted in D1 and not refunded on failure. Restarting or deploying does not reset the lifetime counter. Changing the configured cap changes the maximum, not the count already consumed. No TypeSafe API key is needed for Workers AI. Provider calls use the current `AI.run("typesafe/jev", {state, questions})` format.

The example disables Workers observability logs to avoid retaining request metadata. If you enable infrastructure logs, review their contents and retention separately. Never log authorization headers, complete summaries, raw session IDs or operator API responses. Authenticated erasure remains available after the ingestion quota is exhausted. Hourly cleanup removes four bounded pages (up to 2,000 expired samples per run); larger installations must call `/operator/cleanup` often enough to clear their retention backlog. Discovery runs separately at 03:15 UTC when its holdout manifest is configured.

This deployment is a bounded pilot, not a benchmark demonstrating hundreds of thousands of concurrent inference requests. Ordinary Janitor identity handling remains independent of it.
