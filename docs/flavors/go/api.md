# Go API

The Go client calls a Doorman endpoint hosted in your infrastructure. It projects only `visitorId` and `isReturning`, so private scores cannot accidentally reach the browser through a relay.

[Client installation and methods](../../../packages/go/README.md) cover request context, timeouts and framework integration. [Run the example](../../../examples/go-http/README.md) to test the transport locally.

## What runs where

Your Go route receives the browser's measurements and forwards them with that request's cookies and origin. The upstream TypeScript or Elixir engine owns storage, deterministic matching, Jev, learning and private analytics exports. There is no shared cookie jar, automatic retry or third-party Doorman service.

## Private features

Configure API activity, authenticated cross-device identity and risk export inside the upstream engine. This client does not expose a trusted-identity ingestion API. Never tunnel a browser-supplied actor, account or security event into a trusted context. If you need to share verified context between services, authenticate and scope an application-owned internal route first.

## Errors

Invalid input is rejected before a request is made. An unavailable or malformed upstream becomes a controlled transport error, not a made-up identity or a zero-risk assertion. Your application continues to own authentication and decisions.
