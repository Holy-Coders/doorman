# Go client

Use Go to expose a first-party visitor route backed by a Doorman endpoint you own. The client preserves per-request cookie context and projects only the public response. Matching, Jev, storage, API activity evaluation and private analytics run in your TypeScript or Elixir engine.

## Install

Go 1.23 or newer is required:

```sh
go get github.com/Holy-Coders/doorman/packages/go@v0.12.0
```

The Go submodule uses the `packages/go/v0.12.0` Git tag. For a local checkout, see the example's `replace` directive.

## Mount a route

```go
client, err := doorman.NewClient("https://identity.your-app.example/api/visitor", doorman.Options{})
if err != nil { return err }
mux.Handle("/api/visitor", client.Handler())
```

Import it as `doorman "github.com/Holy-Coders/doorman/packages/go"`. Mount the route behind your application's origin/CSRF and rate controls. The handler accepts only POST JSON, bounds the body, relays Cookie/Origin/CSRF context, returns a controlled error on failure, and appends Set-Cookie without exposing private scores. There is no shared cookie jar. Request cancellation propagates to the upstream call.

## Use your own handler

```go
result, err := client.Identify(r.Context(), doorman.Request{
    Signals: browserSignals,
}, doorman.Context{Cookie: r.Header.Get("Cookie"), Origin: r.Header.Get("Origin")})
if err != nil { /* your controlled failure response */ return }
for _, cookie := range result.SetCookies { w.Header().Add("Set-Cookie", cookie) }
// JSON encoding result includes visitorId and isReturning only.
```

See the [runnable Go example](../../examples/go-http/README.md). For a TypeScript upstream, configure its `allowedOrigins` for the actual browser origin, keep its cookie Domain unset, and preserve CSRF/session context for Phoenix. Optional `BearerToken` comes from your server configuration; an application-owned authenticated gateway must verify it. Never accept an upstream URL or verified identity claims from the browser.

The shared browser SDK collects browser measurements. Sending measurements of the Go server would identify that server, not your visitors. The default timeout is three seconds; redirects and retries are disabled. The transport uses the standard HTTP connection pool and has no background worker or external dependency.

A Phoenix upstream checks the request origin against its public host and scheme. Use an upstream route on the same public origin or a correctly configured, trusted reverse proxy that preserves them; Phoenix does not accept the TypeScript `allowedOrigins` option. Do not disable origin/CSRF checks to make a relay work.
