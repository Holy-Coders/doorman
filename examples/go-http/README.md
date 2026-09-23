# Run the Go example

Start an existing Janitor engine, then run the relay:

```sh
cd examples/go-http
JANITOR_ENDPOINT=https://identity.your-app.example/api/visitor go run .
```

It listens at `http://127.0.0.1:3001/api/visitor`. For local development, the Cloudflare example provides a no-key engine at `http://127.0.0.1:8787/api/visitor` with local D1. Configure its allowed browser origins for your application. In production mount `client.Handler()` inside your existing server's origin/CSRF and rate controls. Optional `JANITOR_GATEWAY_TOKEN` requires your own gateway to verify it.

```sh
curl -i http://127.0.0.1:3001/api/visitor -H 'Content-Type: application/json' -d '{"signals":{}}'
```

This is a transport check, not a browser identity benchmark. Use the JavaScript browser client in your frontend for actual signal collection.
