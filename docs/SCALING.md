# Scale your database

Janitor can search a large visitor database without comparing every stored browser on each visit. It uses database indexes to find a limited set of plausible matches, then spends more work only on that shortlist.

Use Postgres when you expect a large amount of retained history. D1 remains an option for Cloudflare deployments within its storage and query limits. The right size depends on visits, retention and request frequency—not just the number of registered users.

## Does a limit of ten miss the rest of the database?

Ten is the number of visitors sent to the matching engine, not the number of visitors the database can contain. Several indexed lookups first return a larger pool. Janitor ranks that pool before selecting ten visitors and asking Jev about that shortlist in one batched request.

This keeps request work predictable, but it is not an exhaustive search. An older match can fall outside the lookup windows. When a group is too crowded to distinguish safely, Janitor can decline to restore an ID rather than force a match.

Local tests include two million visitors and six million observations. Candidate lookup p95 was 47.40 ms in the latest repeat, versus 6.46 ms in the earlier recorded run. These are shared-host measurements, not a latency guarantee. The methodology and limits are below. For open connections and requests per second, see the separate [capacity report](CAPACITY.md), including its latest failed burst runs.

## Latest six-million-observation repeat

The expanded September 23 validation rebuilt the synthetic fixture on native Postgres 18.1: two million visitors, three observations each, 256 MiB shared buffers and a ten-connection pool. Seeding took 197.2 seconds and index creation took 91.4 seconds.

| Measurement                                   |                                                Result |
| --------------------------------------------- | ----------------------------------------------------: |
| Target in old / indexed shortlist             |                                    0 / 100; 100 / 100 |
| Indexed candidate lookup p50 / p95            |                                      20.54 / 47.40 ms |
| Maximum database candidates returned          |                                                    10 |
| Batched history p95                           |                                               4.42 ms |
| Lookup + history at concurrency 10            |                      756.6 requests/sec; p95 20.76 ms |
| Captured plan                                 | 514 rows; six intended indexes; zero sequential scans |
| Cookie identification p95; evaluator disabled |                                               1.10 ms |

The common identical-profile case abstained, and the selected missing-cookie case did not restore the expected ID. Retrieving a target among ten candidates is not the same as identifying it safely. This run validates bounded retrieval at this database size, not production identity accuracy. The isolated lookup latency was higher than the historical run; other host workloads were not controlled, so the cause and production latency remain unestablished.

[Latest aggregate](benchmarks/scale-2000000x3-validation-2026-09-23.json) · [Latest plan](benchmarks/scale-2000000x3-plan-validation-2026-09-23.json)

## How the lookup stays limited

A **probe** is an indexed lookup using one combination of browser signals. Each eligible probe returns at most 101 retained observations. The extra row tells Janitor when the result was truncated because the group was crowded:

| Probe                                                         | Intended tolerance                      |
| ------------------------------------------------------------- | --------------------------------------- |
| Platform + browser + screen dimensions + hardware concurrency | Timezone and graphics changes           |
| Platform + browser + screen dimensions + timezone             | Hardware reporting and graphics changes |
| Platform + browser + graphics renderer + timezone             | Screen or hardware changes              |
| Platform + browser                                            | Sparse observations / broader fallback  |
| Graphics renderer                                             | Broader fallback                        |
| Timezone + browser                                            | Broader fallback                        |

Screen orientation is normalized before lookup. Missing fields simply omit a probe. Risk, behavior, IP addresses and account IDs are not part of these browser-identity indexes. There is no immutable fingerprint hash standing in for a visitor ID.

At most 606 rows enter deterministic scoring per lookup pass. With planning enabled, an empty restricted lookup can trigger one standard fallback pass (at most 1,212 rows across both). Obvious contradictions and weak matches are removed; observations are deduplicated by visitor; the best ten are selected by similarity, then recency and ID. Five recent observations per selected visitor are loaded using one Postgres `LATERAL` query or one D1 binding batch. Custom storage can retain the original single-history method. Jev evaluates up to ten histories in one identity-only batch and evaluates risk in a separate current-only request; valid cookies skip global retrieval entirely.

If every bucket containing a selected candidate was saturated, restoration abstains even if Jev reports high confidence. Common indistinguishable browsers can remain impossible to separate. A complete matching bucket is a retrieval safeguard, not mathematical proof of uniqueness. Bounded search can miss older matches; expired observations are intentionally ignored. Report recall, false merges and abstentions separately.

The 606-row bound is the **returned pool**, not a guarantee that every database plan physically reads only 606 rows. Maintain indexes/statistics and inspect `EXPLAIN (ANALYZE, BUFFERS)` for your traffic distribution. Composite leading equality keys allow selective index scans; distribution and planner choices still matter. [Postgres multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)

## Recorded database benchmarks

The reproducible benchmark uses the production Postgres storage and matching engine, a fixed synthetic population, 80% identical common-profile traffic, and 20% a varied synthetic tail. It deliberately queries 100 older tail profiles to expose recency crowding. It does not sample real people or establish identification accuracy.

First completed run: **2,000,000 visitors and 2,000,000 observations**, PostgreSQL 17.11 in local Docker, Apple M2 Pro, 32 GiB host RAM, 256 MiB Postgres shared buffers, ten pool connections.

| Measurement                                          |                                 Observed |
| ---------------------------------------------------- | ---------------------------------------: |
| Older target present in old lookup shortlist         |                                  0 / 100 |
| Older target present in new shortlist                |                                100 / 100 |
| New candidate lookup p50 / p95                       |                           3.37 / 4.44 ms |
| Batched history p50 / p95                            |                           0.64 / 1.67 ms |
| Lookup + history at concurrency 10, 200 requests     |         558.8 requests/sec; p95 32.93 ms |
| Captured lookup plan                                 | 508 returned rows; zero sequential scans |
| Cookie identify including writes, evaluator disabled |             p95 2.33 ms over 30 requests |
| Common identical-profile case                        |                                Abstained |

The engine also abstained on the selected tail example: retrieving the target is necessary but does not ensure the ambiguity margin is met. This is deliberately reported rather than calling retrieval recall “100% identity accuracy.” No evaluator call or regional network latency is included. The warm-cache read workload is not a sustained production throughput guarantee.

[Raw first-run result](benchmarks/scale-2000000x1.json) · [EXPLAIN plan](benchmarks/scale-2000000x1-plan.json)

An attempted 2-million-visitor / 10-million-observation Docker run exhausted the local Docker disk allocation during seeding. It is not a passing benchmark and made no changes to production databases. This illustrates the need to provision history and index storage rather than sizing only the visitor table.

### Multiple observations per visitor

A second completed run used **2,000,000 visitors and 6,000,000 observations** (three per visitor), on local native Postgres 18.1. The same Apple M2 Pro/32 GiB host and 256 MiB shared buffers were used, but this is a different database runtime, so it is not a controlled speed comparison with the Docker run.

| Measurement                                    |                                                           Observed |
| ---------------------------------------------- | -----------------------------------------------------------------: |
| Older target retrieved, old / new lookup       |                                                 0 / 100; 100 / 100 |
| Candidate lookup p50 / p95                     |                                                     3.77 / 6.46 ms |
| Batched history p50 / p95                      |                                                     0.31 / 0.67 ms |
| Lookup + history, concurrency 10, 200 requests |                                   772.7 requests/sec; p95 22.97 ms |
| Captured lookup plan                           | 514 returned rows; all six intended indexes; zero sequential scans |
| Cookie identify including writes, no evaluator |                                                        p95 0.87 ms |
| Tables and indexes                             |                                              Approximately 7.88 GB |

As in the first run, both the selected ambiguous tail example and common-profile case abstained. This validates a bounded retrieval path with millions of stored histories, not production fraud-detection accuracy or a sustained throughput SLA. No ten-million-observation pass is claimed.

[Raw history-run result](benchmarks/scale-2000000x3.json) · [EXPLAIN plan](benchmarks/scale-2000000x3-plan.json)

## Reproduce

Use a disposable **local** Postgres database. The script only accepts localhost and creates/replaces its own `janitor_scale_benchmark` schema. Do not use that schema for application data. Plan disk space for JSON, all indexes, WAL and index-build temporary files; the first run occupied approximately 2.74 GB including its two tables and indexes.

```sh
JANITOR_BENCHMARK_DATABASE_URL=postgres://visitor:visitor@localhost:55433/visitors \
JANITOR_BENCHMARK_VISITORS=2000000 \
JANITOR_BENCHMARK_HISTORY=1 \
pnpm benchmark:scale
```

`JANITOR_BENCHMARK_HISTORY` accepts 1–10; increase only with sufficient disk. The script writes raw metrics and the plan to `docs/benchmarks/scale-<visitors>x<history>.json`. Historical observations repeat synthetic profiles: this stresses storage, not browser drift. It leaves only its isolated schema for inspection; drop that schema when finished. No external Jev calls, paid infrastructure, real accounts or analytics events are involved.

## Migration and deployment

Fresh examples apply `0004_candidate_lookup.sql` after the existing migrations. D1 migrations use expression indexes on JSON text; Postgres uses JSONB expression indexes. Existing data is indexed automatically without rewriting stored signal formats or rotating visitor IDs.

For an existing large Postgres database, create the three new indexes **concurrently**, outside a transaction, before rolling out the new code. For example, copy the three statements from [the migration](../packages/storage/postgres/migrations/0004_candidate_lookup.sql), replace `CREATE INDEX IF NOT EXISTS` with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, qualify the application's schema, and run each separately. Verify all indexes are valid and run `ANALYZE observations`. A failed concurrent build can leave an invalid index; resolve it before retrying. Ordinary index creation is appropriate for a fresh/empty database, but blocks writes on an existing table. [Postgres CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)

Native Phoenix: fresh `Janitor.Migration.up()` includes these indexes. Existing apps create a new Ecto migration calling `Janitor.Migration.upgrade_lookup()`. For large live databases, prebuild valid concurrent indexes outside Ecto's transaction first; the migration's `IF NOT EXISTS` statements then record the upgrade without rebuilding them. Use the same `prefix` configured in `Janitor.new`.

## Cloudflare with Postgres

`createCloudflareVisitor` accepts a D1 binding **or** a compatible Postgres client/pool. Jev still uses the AI binding:

```ts
const visitor = createCloudflareVisitor({
  db: postgresClient, // e.g. a pg client configured through your Hyperdrive binding
  ai: env.AI,
});
return visitor.handle(request);
```

The application owns driver setup and connection lifecycle. Configure Workers `nodejs_compat` and your chosen Postgres/Hyperdrive integration according to [Cloudflare's driver guidance](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/). Use a [cache-disabled Hyperdrive configuration](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/) for mutable identity/history reads and delegation revocation checks. Node/Vercel and native Phoenix already use Postgres.

A single D1 database is limited to 10 GB on the paid plan, and processes queries one at a time. That does not make D1 unsuitable for every sizable application, but one D1 database is not our default recommendation for millions of visitors with retained history. D1 sharding also requires a stable routing strategy; casually splitting by a changing fingerprint would break lookup. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Maintenance and capacity

`cleanup()` performs one bounded maintenance page, default 100 visitors/expired rows and maximum 1,000. It returns progress:

```ts
const page = await visitor.cleanup({ batchSize: 100, afterVisitorId: cursor });
// Persist page?.nextVisitorId in your existing maintenance task.
// Continue visitor pages until it is undefined. Run additional expiry
// batches while page?.hasMoreExpired is true. Start a new sweep periodically.
```

Elixir uses `Janitor.cleanup(config, batch_size: 100, after_visitor_id: cursor)` and returns `%{next_visitor_id: ..., has_more_expired: ...}`. Count repair only examines selected visitor histories; it no longer ranks the whole observations table in one window operation. Each observation save still prunes that visitor. Reads enforce expiry even before physical cleanup.

The optional identity/delegation and learning modules have their own maintenance; those workloads are not covered by the browser-lookup benchmark. Profile their cleanup separately before a large rollout. They are disabled unless configured.

Operationally, size Postgres for **visitors × retained observations × payload and index size**, plus headroom, WAL, vacuum and backups. Use a bounded pool and existing application admission limits. Monitor p95/p99 latency, pool wait, rows/buffers read, write/cleanup latency, disk/index growth, saturation/abstention, and evaluator availability/calls/cost. A model timeout does not guarantee the provider stops billing. Partitioning or additional infrastructure should follow measured bottlenecks, not the mere presence of a million-row table.
