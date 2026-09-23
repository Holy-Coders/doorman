# Connect Go to the learning service

Call the learning service from your Go backend using a fixed HTTPS URL and a private participant key. Your existing Janitor identity endpoint remains independent. The service's participant preferences default to disabled.

Enable evaluation explicitly with `POST /v1/preferences` and `{"evaluation":true,"contribution":false,"training":false}`. The operator must also configure an evaluator and budget. A remote assessment never contributes its inputs to training automatically.

```go
// Required imports: bytes, context, encoding/json, errors, io, net/http, time.
func evaluate(ctx context.Context, endpoint, key string,
    features map[string]float64) (map[string]any, error) {
    ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
    defer cancel()
    payload, err := json.Marshal(map[string]any{
        "version": 1, "features": features,
    })
    if err != nil { return nil, err }
    req, err := http.NewRequestWithContext(ctx, "POST",
        endpoint+"/v1/evaluate", bytes.NewReader(payload))
    if err != nil { return nil, err }
    req.Header.Set("Authorization", "Bearer "+key)
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 1500*time.Millisecond,
        CheckRedirect: func(*http.Request, []*http.Request) error {
            return http.ErrUseLastResponse
        },
    }
    response, err := client.Do(req)
    if err != nil { return nil, err }
    defer response.Body.Close()
    if response.StatusCode != http.StatusOK {
        return nil, errors.New("learning service unavailable")
    }
    data, err := io.ReadAll(io.LimitReader(response.Body, 16385))
    if err != nil { return nil, err }
    if len(data) > 16384 { return nil, errors.New("response too large") }
    var result map[string]any
    err = json.Unmarshal(data, &result)
    return result, err
}
```

Populate the allowlisted numeric features from your server's selected operation summaries. Do not forward request headers, URLs, full browser payloads or credentials. Validate the response before applying policy; on any error, keep local identity handling and mark remote risk unavailable. Keep results private. This direct HTTP example is separate from the Go browser-identity transport.

Contribution requires its own application opt-in and service preferences. Training additionally requires operator approval. Sample sessions independently of their outcome and send one immutable summary per session/day to `/v1/contributions`. Use an application-specific random HMAC secret to derive a daily rotating session reference, a retained opaque sample ID, minute-rounded observation time and allowlisted features. Do not send raw session/user IDs.

When an outcome is independently confirmed, send `/v1/feedback` with the sample ID, `assistant` or `abuse` target, outcome, provenance category and an HMAC evidence reference. `verified-delegation` is a positive assistant label only. `confirmed-incident` is a positive abuse label only. `reviewed-session` requires an independent review. Neither model predictions nor login alone prove a human or an attacker. The service trusts an approved implementer's attestation.

`DELETE /v1/contributions/:sampleId` removes one snapshot and its labels. Omit the ID to erase all of the participant's contributions. Revoking contribution through `/v1/preferences` also erases stored samples. Stop your senders before revocation and include retained sample IDs in account/session deletion.

The [protocol schemas](../../../protocol/network.schema.json) define exact request keys. Read [how discovery, holdouts and rollout work](../../LEARNING-NETWORK.md) before connecting pattern evidence to application policy.
