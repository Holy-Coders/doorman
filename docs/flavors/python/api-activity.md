# Understand API activity

API activity evaluation currently runs in the TypeScript and Elixir engines. The Python client relays browser measurements; it does not intercept every request or export application logs.

If the API operation runs in a Node or Phoenix service, enable its activity middleware there. That service knows the router template, authenticated actor, result status and duration, and can keep the assessment private.

If your operation runs in Python, keep the operation's telemetry in your own application for now. There is no built-in remote activity ingestion endpoint in this SDK. Adding one requires application-owned service authentication, tenant isolation and a strict aggregate schema; a public visitor route is not a trusted evidence channel.

The [TypeScript guide](/docs/api-activity/) and [Elixir guide](/docs/elixir/api-activity/) show the native integrations. Your Python browser route continues to work independently.
