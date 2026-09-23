# Connect a Phoenix application to the learning service

The learning service accepts authenticated JSON from your server. You can use `Req`, already included by Doorman, without running a JavaScript client in Phoenix. Your existing `Doorman` instance keeps handling identity and authentication locally.

An operator supplies the service URL and a private participant key. All preferences begin disabled. To opt into evaluation only, send `POST /v1/preferences` once with `{"evaluation":true,"contribution":false,"training":false}`. The service operator must separately enable a provider and a spending budget.

## Read a private assessment

```elixir
# Application-owned, bounded summaries; never pass params or full logs here.
features = %{"api_request_count" => 40, "api_denied_ratio" => 0.05}

{:ok, response} = Req.post(
  url: System.fetch_env!("DOORMAN_NETWORK_URL") <> "/v1/evaluate",
  auth: {:bearer, System.fetch_env!("DOORMAN_NETWORK_KEY")},
  json: %{version: 1, features: features},
  retry: false,
  redirect: false,
  receive_timeout: 1_500,
  connect_options: [timeout: 1_000]
)

# Read response.body only on status 200. Keep it in server-side context.
# On transport/error/timeout, continue with your local Doorman result.
```

The numbers above illustrate the protocol; derive yours from the private summary in `conn.assigns.doorman_api_activity` or an application-owned session aggregate. `api_duration_mean_ms` measures handler time, not a person's thinking time. Do not forward the entire assigns map or request headers. Use your normal bounded HTTP transport for production response validation and size limits; this snippet is the wire request, not an additional built-in Doorman transport API.

## Contribute and label a snapshot

Contribution is separate from inference. Your collection policy must enable it, and the service operator must approve your application before training can be enabled. Set the three `/v1/preferences` booleans explicitly. Keep sampling deterministic per session and independent of its eventual outcome.

Prepare the contribution on your server:

```elixir
now = System.system_time(:millisecond)
secret = System.fetch_env!("DOORMAN_NETWORK_REFERENCE_SECRET")
day = div(now, 86_400_000)
reference = "ref_" <> Base.encode16(
  :crypto.mac(:hmac, :sha256, secret, Jason.encode!([day, server_session_id])),
  case: :lower
)

sample = %{
  version: 1,
  sampleId: "sample_" <> String.slice(reference, 4, 32),
  sessionReference: reference,
  observedAt: div(now, 60_000) * 60_000,
  features: features,
  cohort: "unknown",
  trainingAllowed: true
}
# POST this same immutable object to /v1/contributions.
# Save the returned sampleId with your session for later feedback and erasure.
```

The secret must be random, unique to your application and at least 32 characters. Sample one snapshot per session/day; the TypeScript helper defaults to 1%. These references remain pseudonymous data.

After your server verifies an assistant credential and its current delegation, `POST /v1/feedback` with the sample ID, `target: "assistant"`, `positive: true`, `source: "verified-delegation"`, and an HMAC `evidenceReference` for the internal verification record. The verified attribution is in `conn.assigns.doorman_identity["attribution"]` when produced by `Doorman.Plug`; do not use a client-provided actor claim. The shared service trusts your attestation rather than independently checking your issuer. A verified assistant is not automatically benign.

`reviewed-session` and `confirmed-incident` support independently investigated outcomes. Jev predictions, successful logins and CAPTCHA results alone cannot label a human or attacker. See the [versioned schemas](../../../protocol/network.schema.json) for exact keys and permitted fields.

`DELETE /v1/contributions/:sampleId` erases one snapshot and its labels; omit the ID to erase all of your participant's contributions. Disable contribution through `/v1/preferences` to stop collection at the service and erase existing samples. Stop sending from your application too.

See [discovery, holdouts and rollout](../../LEARNING-NETWORK.md). The shared learner discovers readable rules; it does not connect identities across customers or fine-tune Jev weights.
