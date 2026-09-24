# Python client

Use Python to relay browser measurements to a Doorman endpoint that you own. Matching, storage, Jev evaluation and private analytics exports run in that TypeScript or Elixir endpoint. This package is a small HTTP client, not a second matching engine.

## Install

Python 3.10 or newer is required. The developer preview is installed from GitHub, not PyPI:

```sh
python -m pip install 'doorman-identity-client @ git+https://github.com/Holy-Coders/doorman.git@v0.13.0#subdirectory=packages/python'
```

For a local checkout: `python -m pip install ./packages/python`.

## Identify a browser

```python
from doorman_client import Client, DoormanError

doorman = Client("https://identity.your-app.example/api/visitor", timeout=3)
result = doorman.identify(
    signals=browser_payload["signals"],
    behavior=browser_payload.get("behavior"),
    cookie=request.headers.get("Cookie", ""),
    origin=request.headers.get("Origin", ""),
)
# Return only result.public_json() to the browser.
# Append each result.set_cookies entry as a separate Set-Cookie response header.
```

There is no shared cookie jar: one Python `Client` can serve many users without mixing their identities. Cookie and origin context belongs to each call. The client bounds request/response bytes, validates the public result, uses a timeout, and refuses redirects. It never forwards scores or debug data to a browser. A failure raises `DoormanError`; your route can return a controlled 503 while leaving the rest of your application available.

## Route setup

Start with the [Flask example](../../examples/python-flask/README.md). Django and other Python frameworks can use the same client: parse a bounded JSON body, pass request-specific context, return `result.public_json()` and append the response cookies.

For a TypeScript upstream, configure the Doorman handler's `allowedOrigins` for your actual application origin. Keep cookie `Domain` unset so the relayed cookie is first-party on your application. Preserve CSRF/session context when relaying to Phoenix. Set `bearer_token` only from server configuration if your own gateway requires it; Doorman does not create or validate a gateway token automatically. Never use a visitor-supplied upstream URL or forward account/actor claims as authenticated facts.

No API keys, raw IPs, request bodies, browser attributes or identity results are logged. Your application owns origin/CSRF checks, authentication, rate limits and analytics policy. `identify()` calls are synchronous; use your framework's threadpool when calling from an async route. Browser collection still uses the shared JavaScript SDK.

A Phoenix upstream checks the request origin against its public host and scheme. Use an upstream route on the same public origin or a correctly configured, trusted reverse proxy that preserves them; Phoenix does not accept the TypeScript `allowedOrigins` option. Do not disable origin/CSRF checks to make a relay work.
