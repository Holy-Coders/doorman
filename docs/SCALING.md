# Deployment and scale

Run Doorman inside your existing application with Postgres or Cloudflare D1. You do not need a queue, background worker, shared learning service or model-training pipeline.

## Before serving traffic

- Reuse one TypeScript handler rather than creating a new one per request. Phoenix reuses the running Ecto repo.
- Keep the identity secret and namespace stable across instances.
- Use HTTPS and the secure cookie defaults.
- Give the database connection permission to create Doorman's tables. Optionally call `ready()` during startup; normal first use also prepares them.
- Configure database pool, query and HTTP deadlines in your application.
- Run `cleanup()` from existing maintenance and monitor database growth.

[Storage and deletion](../site/content/storage.md) covers retention, bounded cleanup and restricted schema ownership. [Request limits](HARDENING.md) covers measurement admission and shared AI budgets.

## Does Doorman only search ten visitors?

No. Ten is the final candidate limit, not a database-size limit. Indexed queries retrieve bounded pools of plausible observations, rank them, and load only recent histories for the best candidates. Cookie visits skip global candidate search.

Current TypeScript storage has at most six lookup families, each returning at most 101 observation rows. The extra row detects a crowded bucket. The engine scores the returned pool, removes contradictions, and keeps at most ten visitors with five recent observations each. The recommended API does not ask Jev to plan database queries.

Bounded lookup can miss older matches or abstain in common device populations. Indexes limit the search but do not guarantee a constant amount of physical database work for every distribution. Inspect your query plans and realistic traffic. [Matching behavior](MATCHING.md).

## Millions of rows versus concurrent requests

The recorded database experiment used two million synthetic visitors and six million observations. It exercised indexed retrieval, not two million active people or sustained production inference.

Separate 200,000-connection experiments included controlled overload responses. An open socket is not a successful identification. Those tests do not establish hundreds of thousands of simultaneous successful database writes or Jev evaluations.

Plan capacity using successful identifications per second, p95/p99 latency, database queueing, controlled rejections, recovery and provider costs. [Testing and limits](VALIDATION.md) links the dated reports.

## Choose your storage

Use your existing Postgres deployment when you need substantial retained history and control over pools, indexes and capacity. D1 fits applications already running on Cloudflare within that deployment's database limits. Retention and observations per browser affect storage as much as the visitor count.

A shared database budget coordinates replicas, but Doorman is not a hosted multi-tenant platform. Use a separate database/schema per application. Authentication, backups, monitoring, deployment and incident response remain in your existing stack.

## Test your deployment

Exercise cookie returns, missing cookies, cold starts, database failure and evaluator failure separately. Include production-like signal distributions rather than only unique synthetic devices. Increase load in steps and confirm that overloaded measurement requests do not break unrelated application routes.

Use the repository's benchmark commands only against databases and environments intended for testing. The [archive](archive/README.md) retains the methodology and historical raw-result links; its older API setup instructions are not required for current installation.
