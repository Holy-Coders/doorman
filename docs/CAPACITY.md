# Connection capacity and load

This page helps you distinguish open connections from successful identity requests. Janitor is a request handler; it does not create a long-lived connection for each browser. Your hosting stack handles connections, while your database and optional AI provider determine how much identity work can run at once.

## How to read the results

Earlier local runs kept 200,000 HTTP connections open and recovered after overload without dropped connections. **The latest validation did not reproduce that burst stability:** two repeat runs lost connections. Keeping idle sockets open does not establish safe handling of 200,000 simultaneous identifications. The latest failures are reported below, followed by the historical measurements.

## Latest validation: the large burst failed

The September 23 expanded validation reused the eight-worker, 2 GiB server-container configuration. Both runs reached 200,000 open connections and completed all 1,500 scheduled identifications at 100 requests/second. The simultaneous burst then failed:

| Run               | Unexpected connection closes | Burst outcome                                                            | Recovery            |
| ----------------- | ---------------------------: | ------------------------------------------------------------------------ | ------------------- |
| First             |                       25,000 | Stats transport failed; the original harness did not retain burst totals | Not reached         |
| Diagnostic repeat |                       50,000 | 14 identities, 150,831 controlled 503s, 49,155 transport errors          | 75 / 100 successful |

The diagnostic repeat recorded two worker exits with `SIGKILL`. The exact kill cause was not captured before restart; these results do not prove a particular memory or library defect. The host also ran unrelated workloads, so this is not an isolated comparison against the earlier run. We did not change those workloads.

The harness now retains partial burst/recovery outcomes when a stats endpoint fails, saves worker logs before cleanup and runs the smaller throughput sweep even after a failed large burst. A failing stage still makes the command fail. These are measurement fixes, not an application-capacity fix.

Do not size production from the historical success alone. Bound connections and bursts at ingress, provision and measure memory under active request load, then validate recovery and sustained useful throughput on the actual deployment. These tests use deterministic identity evaluation; they do not measure live Jev at this concurrency.

[First failed run](benchmarks/connections-validation-first-2026-09-23.json) · [Diagnostic repeat](benchmarks/connections-validation-repeat-2026-09-23.json) · [Detection and live Jev validation](DETECTION-VALIDATION.md)

The independent **10,000-connection** sweep completed all 1,500 requests at 100/sec, all 7,500 at 500/sec, and all 15,000 at 1,000/sec. At 2,000/sec it completed 29,758 identities and returned 242 controlled 503s. Its 10,000-request burst returned 68 identities and 9,932 controlled 503s, with 100/100 successful recovery and no unexpected socket closes. This smaller run passed; it does not cancel the larger run's failures. [Latest throughput report](benchmarks/throughput-validation-2026-09-23.json) · [Latest security/storage workload](benchmarks/security-validation-2026-09-23.json)

Three measurements matter separately:

- **Connections:** sockets kept open by the HTTP server.
- **Throughput:** successful identifications completed per second.
- **Latency:** how long a request took. For example, p95 is the duration below which 95% of the measured requests completed.

The measurements below were recorded on September 23, 2026 with the v0.7.0 implementation. They use generated data and mocked inference on a local developer machine. Use them to understand the design and reproduce workloads, not as a production capacity guarantee or a claim about Jev’s service capacity.

## One million application events

PostgreSQL 17 in Docker, limited to two CPUs and 1 GiB RAM, 128 MiB shared buffers, an eight-connection pool. Host: Apple M2 Pro, 32 GiB RAM. Seed: 1,000,000 events plus one API-created seed event across 100,001 synthetic subjects. Half the events belong to one hot subject. The remaining half are spread across 100,000 subjects. Table and indexes occupy approximately 1.83 GiB; text IDs, JSON and all erasure/query indexes are included.

Each workload uses closed-loop concurrency 1, 16, 64 and 256; normally 1,000 operations per point, 256 for hot activity queries. Writes call the real evidence API, including HMAC, validation and SQL. Risk calls are mocked with five milliseconds of delay. Query plans use `EXPLAIN (ANALYZE, BUFFERS)`.

| At concurrency 256                 |    Before |    After |
| ---------------------------------- | --------: | -------: |
| Shared global quota admissions/sec |   4,203.5 |  8,346.8 |
| Quota admission p95                |  62.26 ms | 37.95 ms |
| Hot-account activity queries/sec   |     629.1 |  2,797.0 |
| Hot-account query p95              | 374.91 ms | 73.61 ms |
| Event inserts/sec                  |   8,193.4 |  7,829.9 |
| Sparse activity queries/sec        |   8,232.8 |  8,217.7 |

Changes: the hot activity query now retrieves only event types instead of full JSON records, and the global request quota can distribute its fixed allowance across 32 rows. Neither change alters risk/confidence or associates anonymous browsers with accounts. Indexes and the ten-candidate matching limit stay unchanged. Both captured activity plans use `idx_events_subject_action`, without sequential scans; the hot plan returns exactly 1,001 rows, including the saturation sentinel. Saturated counts remain lower bounds.

The baseline used production code from `04236ce`; the optimized run used the v0.7.0 implementation. Runs were sequential, warm-cache, on a shared developer machine; the second began while the idle HTTP harness initialized its small visitor fixture. Normal benchmark writes grew the event population to 1,004,001 before the second run. This is a diagnostic comparison, not a controlled statistical performance study. The event insert rate did not improve. The first seed's explicit vacuum hit its short lock timeout while maintenance was active; the completed baseline reused the successfully seeded data. The harness now grants maintenance its own bounded, longer deadline.

[Raw baseline and plans](benchmarks/security-baseline.json) · [Raw optimized result and plans](benchmarks/security-optimized.json)

## 200,000 live HTTP connections

Eight Node 22.23.2 processes in one Docker container limited to four CPUs and 2 GiB RAM. The client used a separate two-CPU, 2 GiB container on the same local Docker network. The database retained its separate two-CPU/1 GiB limit. Each process listened on a different port; the generator distributed connections evenly. This does **not** test a production load balancer, TLS, HTTP/2, regional network latency or cloud edge capacity.

Each socket completed an HTTP/1.1 warmup exchange, stayed open using keep-alive, and was counted on both client and server. All 200,000 connections remained open through measurement, overload and recovery. Warmup hits a readiness route; it is not counted as identity throughput. Keep-alive was deliberately extended to ten minutes for this experiment. The sampled worker RSS total was approximately 1.64–1.70 GiB; that excludes the primary process, kernel/socket accounting, client and database. Provision headroom rather than treating 2 GiB as a recommended production size.

| Phase                                | Observed                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Ramp                                 | 200,000 established, warmed HTTP connections in about 18 seconds             |
| Active work with all sockets open    | 1,500 successful identifications at 100 offered/sec; p95 7.75 ms             |
| Simultaneous burst                   | 200,000 requests; 16 successful identities, 199,984 controlled 503 responses |
| Burst drain                          | 14.59 seconds; aggregate response p95 10.05 seconds                          |
| Database connections                 | At most eight total, one per worker                                          |
| Database pool waiters                | At most seven per worker, rather than 200,000 queued database callers        |
| Recovery                             | 100/100 subsequent identifications succeeded                                 |
| Transport errors / unexpected closes | Zero / zero                                                                  |

The burst's 503s comprise 199,895 early overload rejections and 89 admitted requests that failed under the database/driver deadline. They are unavailable measurements, not successful identifications or proof of low risk. Local admission protects the database, but socket parsing, application callbacks and response writes still consume CPU. Returning most requests as 503 is **not** a claim to serve 200,000 simultaneous successful identities. An upstream connection/admission boundary is still needed for production bursts and network abuse.

[Raw connection result](benchmarks/connections-200000.json) · [Initial 1,000-connection smoke test](benchmarks/connections-1000.json)

## Sustained identity throughput

A separate run retained 10,000 HTTP connections and offered requests on a clock schedule for 15 seconds per rate. It used the real cookie/history/save/touch path, shared protection with 32 quota shards, eight database connections and deterministic-only evaluation. The generator reports schedule misses instead of silently slowing its offered load. The small fixture contains 10,000 known browser IDs with common synthetic signals; it does not measure missing-cookie candidate search or cross-device accuracy.

| Offered/sec | Successful identities | 503s | Completed/sec including drain | Successful p95 | Schedule misses |
| ----------- | --------------------: | ---: | ----------------------------: | -------------: | --------------: |
| 100         |         1,500 / 1,500 |    0 |                         100.0 |        4.24 ms |               0 |
| 500         |         7,500 / 7,500 |    0 |                         499.9 |        8.78 ms |               0 |
| 1,000       |       15,000 / 15,000 |    0 |                         999.4 |        2.45 ms |             117 |
| 2,000       |       29,770 / 30,000 |  230 |                       1,982.1 |        2.57 ms |           7,425 |

A schedule miss means the generator was more than one inter-arrival interval late; all scheduled requests were still attempted. At 2,000/sec the generator had significant jitter and produced bursts, so that row does not establish a precise server saturation point. A later 10,000-request burst produced 154 identities and 9,846 overload responses, followed by 100/100 successful recovery requests. No socket was lost.

[Raw rate sweep](benchmarks/throughput-10000.json)

The final launcher smoke run repeated this sweep after reseeding with only 10,000 application events (the HTTP visitor fixture stayed at 10,000). It returned 14,992/15,000 successful identities at 1,000/sec and 29,669/30,000 at 2,000/sec, with 8 and 331 overload responses respectively. All sockets stayed open and recovery was 100/100. This variation reinforces that the first zero-error point is an observation, not a guaranteed rate. [Raw launcher repeat](benchmarks/throughput-10000-repeat.json)

The higher-rate repeat with **200,000 connections still open** produced the following results under the same small worker limits:

| Offered/sec | Successful / attempted |        503s | Successful p95 | Completed/sec |
| ----------- | ---------------------: | ----------: | -------------: | ------------: |
| 1,000       |        14,825 / 15,000 | 175 (1.17%) |        3.14 ms |         987.7 |
| 2,000       |        29,156 / 30,000 | 844 (2.81%) |       20.86 ms |       1,940.6 |

All connections remained open and all 100 recovery requests succeeded. This repeat's simultaneous burst returned 43 identities and 199,957 controlled 503s in 7.56 seconds. The generator again reported scheduling jitter (163 and 7,835 misses). Higher connection residency consumed most of the server container's memory allowance; the results show that the successful 10,000-connection throughput cannot simply be assumed at 200,000 connections. A longer soak and resource/worker tuning against an explicit rejection/latency target remain necessary. [Raw active 200,000-connection run](benchmarks/connections-200000-active.json)

## Configure request and database limits

Create one reusable adapter per application instance. The TypeScript HTTP adapters admit at most 64 measurements at once by default (`maxInFlightRequests`, allowed 1–1,024). Excess calls get 503 with `Retry-After: 1` before body parsing, quota SQL or matching. Slots are released after success, invalid input and failures. No request queue is installed. `onOverload` emits a callback without payload data. The benchmark deliberately used eight slots and one pool connection per process, rather than the defaults.

```ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  connectionTimeoutMillis: 500,
  statement_timeout: 2000,
});
const visitor = createNodeVisitor({
  db: pool,
  maxInFlightRequests: 32,
  onOverload: () => metrics.increment("janitor.overload"),
  protection: {
    secret: process.env.JANITOR_PROTECTION_SECRET!,
    namespace: "my-app",
    requests: { global: 60_000, shards: 32, windowMs: 60_000 },
  },
});
```

These values illustrate separate limits; tune them from workload measurements. A handler constructed anew per request cannot share a local concurrency limit. The Cloudflare example reuses its adapter inside the isolate. A hung storage call continues occupying its slot until the driver resolves it; arbitrary database operations are not canceled by returning from another promise. Set actual driver/server deadlines. Direct core calls, evidence management APIs and the application's other endpoints require their own admission boundary. The caller must drain or close unread request bodies when its framework streams them into the adapter.

`requests.shards` defaults to one and accepts 1–128. With more than one shard, allowances sum to the configured global maximum, distributed by integer division/remainder, and all windows align to Unix-epoch boundaries. A request uses one shard and never borrows from another. This reduces contention but can reject early when one slice is exhausted; capacity is conservative. Account/session counters remain exact independent counters. The global key, secret, shard count, limit and clock configuration must agree across replicas and languages. Changing shards/namespace/secret starts different counters: drain the old fleet and let its old window expire before switching. Do not mix configurations to evade or accidentally double a budget. Fixed windows can burst at boundaries; this is not a sliding-window guarantee.

Native Elixir uses the same sharded SQL/HMAC contract and smaller event projection. Phoenix connection capacity was **not** measured by the Node test. Its application owns Bandit/Cowboy admission and Ecto's bounded connection pool/queue settings. DBConnection already sheds work when checkout waits exceed its configured queue policy; configure query deadlines and measure that deployment separately. [DBConnection queue controls](https://hexdocs.pm/db_connection/DBConnection.html#start_link/2)

## Plan a test for your deployment

Support hundreds of thousands of **connected application sessions** through a connection-handling tier and multiple stateless application instances, each with a small database pool and explicit measurement admission. HTTP keep-alive sockets and Phoenix LiveView/WebSocket sessions are different workloads. Janitor itself does not create long-lived browser connections. Spread browser collection over time and avoid a coordinated identify-on-every-render or retry storm. Honor Retry-After with bounded randomized backoff at the application; do not treat an unavailable measurement as authentication.

Size actual work from identification frequency: 200,000 sessions measured once per minute offer about 3,333 identifications/sec; once per ten minutes, about 333/sec, before retries/new arrivals. This is arithmetic, not measured fleet capacity. Missing-cookie lookup and AI calls cost more than the measured cookie path. Keep Postgres pool totals within the database's connection budget across every replica; one client connection must not imply one database connection. [node-postgres pool sizing](https://node-postgres.com/guides/pool-sizing), [Postgres row lock behavior](https://www.postgresql.org/docs/17/explicit-locking.html), [Node HTTP connection controls](https://nodejs.org/download/release/latest-jod/docs/api/http.html).

Before a production capacity commitment, measure TLS/load-balancer behavior, multi-host traffic, a long soak, failover, distributed-clock boundaries, pool/CPU saturation, missing-cookie mix, event writes, learning enabled, Phoenix/LiveView behavior and paid Jev capacity/cost under an explicit budget. The current global inference-control row is intentionally a small shared budget/circuit, not a high-volume inference dispatcher. Anonymous cross-device and bot accuracy still need independently labeled data. No graph database, Redis, queue or background service was added to the library.

## Reproduce locally

Requires Docker, Node 22.12+, pnpm and Bash. Reserve approximately 5 GiB of Docker memory and at least 4 GiB disk for these disposable benchmark resources, in addition to other applications. The database is reachable only on loopback port 55434; the HTTP tier is exposed only to its dedicated Docker network. This runner refuses existing benchmark resource names and removes only resources it creates, including the anonymous database volume. It does not prune Docker, change host limits or contact production.

```sh
pnpm install --frozen-lockfile
pnpm benchmark:capacity
```

This seeds the million-event dataset, benchmarks evidence/protection, opens 200,000 connections, runs the burst/recovery test and a 10,000-connection rate sweep. Raw output is written as `security-current.json`, `connections-current.json` and `throughput-current.json` under `docs/benchmarks/`; recorded historical results are preserved. Reduce `JANITOR_BENCHMARK_CONNECTIONS` for a smaller smoke run. Limit adjustments apply only inside the benchmark containers. Successful completion of the command must still be assessed using success/overload counts and latency in the JSON; absence of a transport crash is not a throughput SLA.

For the higher-rate workload with all 200,000 connections open, run `JANITOR_BENCHMARK_RATES=100,1000,2000 pnpm benchmark:capacity`. A smaller launcher smoke test is `JANITOR_BENCHMARK_EVENTS=10000 JANITOR_BENCHMARK_SAMPLES=100 JANITOR_BENCHMARK_CONNECTIONS=1000 pnpm benchmark:capacity`; it still runs the separate 10,000-connection rate sweep.

To measure only the evidence SQL against an explicitly supplied disposable local database:

```sh
JANITOR_BENCHMARK_DATABASE_URL=postgres://visitor:visitor@127.0.0.1:55434/janitor_bench \
JANITOR_BENCHMARK_SHARDS=32 JANITOR_BENCHMARK_LABEL=my-run pnpm benchmark:security
```

The SQL benchmark recreates only `janitor_security_benchmark` in that local database; `JANITOR_BENCHMARK_REUSE=1` keeps an existing fixture. The HTTP server resets that schema's synthetic observation fixture before starting. Do not point either tool at an application's data, even locally. Dataset size, offered rates, machine limits, errors, saturation, p95/p99, pool waits and query plans are part of the result, not hidden success criteria.
