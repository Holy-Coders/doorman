# Connect Python to the learning service

The optional learning service uses a server-to-server HTTPS protocol. Your Python application can call it directly while the existing Janitor endpoint continues to handle visitor identity. No browser API key is involved.

The operator supplies `JANITOR_NETWORK_URL` and `JANITOR_NETWORK_KEY`. Participant preferences start disabled. Explicitly enable evaluation with `POST /v1/preferences` and `{"evaluation":true,"contribution":false,"training":false}`. The operator separately configures a provider and its budget.

```python
import json
import os
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect)

def assess_features(features):
    request = urllib.request.Request(
        os.environ["JANITOR_NETWORK_URL"].rstrip("/") + "/v1/evaluate",
        data=json.dumps({"version": 1, "features": features}).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["JANITOR_NETWORK_KEY"],
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with opener.open(request, timeout=1.5) as response:
            payload = response.read(16_385)
            if len(payload) > 16_384:
                raise ValueError("Response too large")
            result = json.loads(payload)
            # Validate result against the protocol before applying policy.
            return result
    except (OSError, ValueError):
        return {"riskStatus": "unavailable",
                "risk": {"automation": 0, "suspicious": 0}}

# Derive these values from your own selected API operations, not request JSON.
assessment = assess_features({"api_request_count": 40,
                              "api_denied_ratio": 0.05})
```

This is a direct protocol example, separate from the Python browser-identity transport. Use a fixed HTTPS endpoint (loopback HTTP only for development). Keep assessments private and retain local identity behavior on errors. A socket timeout is not a complete request deadline for every transport; use your application's bounded HTTP client in production.

To contribute, independently enable collection in your application and `/v1/preferences`. Training additionally requires operator approval and `training: true`. Send one immutable, sampled summary to `/v1/contributions`, retaining the returned sample ID. Its schema requires a daily rotating application-specific HMAC session reference, minute-rounded observation time, allowlisted numeric features, optional known evaluation cohort, and explicit `trainingAllowed`.

Later, send `/v1/feedback` with that sample ID, target (`assistant` or `abuse`), independent outcome, provenance source and HMAC evidence reference. An assistant label requires your server to verify its credential/delegation or independently review the session. A login or Jev prediction does not prove which human/assistant operated it. The shared service trusts the approved implementer's attestation.

`DELETE /v1/contributions/:sampleId` erases the snapshot and labels; omitting the ID erases all of your participant's samples. Revoking contribution through preferences also deletes them. Coordinate your own in-flight senders and downstream exports.

Use the [versioned protocol schemas](../../../protocol/network.schema.json) for request/response integration and read [how discovery is evaluated](../../LEARNING-NETWORK.md) before using any pattern as application policy.
