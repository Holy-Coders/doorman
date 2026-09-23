import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import pg from "pg";
import {
  createPostgresEvidenceStorage,
  createPostgresProtectionStorage,
} from "@janitor/storage-postgres";
import { createEvidence } from "../../packages/adapters/src/evidence.js";
import { createProtection } from "../../packages/adapters/src/protection.js";
import { normalizeObservation } from "@janitor/core";

const url = process.env.JANITOR_BENCHMARK_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw Error(
    "Set JANITOR_BENCHMARK_DATABASE_URL to disposable local Postgres.",
  );
const count = Number(process.env.JANITOR_BENCHMARK_EVENTS ?? 1_000_000);
const samples = Number(process.env.JANITOR_BENCHMARK_SAMPLES ?? 1000);
const shards = Number(process.env.JANITOR_BENCHMARK_SHARDS ?? 1);
const label = process.env.JANITOR_BENCHMARK_LABEL ?? "baseline";
if (
  !Number.isSafeInteger(count) ||
  count < 10_000 ||
  count > 3_000_000 ||
  !Number.isInteger(samples) ||
  samples < 100 ||
  samples > 10_000 ||
  !/^[a-z0-9-]{1,40}$/.test(label)
)
  throw Error("Invalid benchmark bounds");
const schema = "janitor_security_benchmark";
const pool = new pg.Pool({
  connectionString: url,
  max: 8,
  connectionTimeoutMillis: 2000,
  options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=2000`,
});
const query = (sql: string, args?: unknown[]) => pool.query(sql, args);
const root = new URL("../../", import.meta.url);
const identity = {
  secret: "synthetic-benchmark-only-".repeat(3),
  namespace: "security-benchmark",
};
const evidence = createEvidence(createPostgresEvidenceStorage(pool), identity);
const subject = (n: number) => `sub_${n.toString(16).padStart(64, "0")}`;
const visitor = (n: number) => `vis_${n.toString(16).padStart(48, "0")}`;
const protectionStore = createPostgresProtectionStorage(pool);
const observations: Record<string, unknown>[] = [];
const errors: Record<string, number> = {};
const summary = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b);
  const q = (p: number) =>
    +(
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
    ).toFixed(2);
  return { p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: q(1) };
};
async function load(
  name: string,
  concurrency: number,
  fn: (i: number) => Promise<unknown>,
  requests = samples,
) {
  let next = 0,
    failed = 0,
    waiting = 0,
    active = 0;
  const outcomes: Record<string, number> = {};
  const latencies: number[] = [];
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const timer = setInterval(() => {
    waiting = Math.max(waiting, pool.waitingCount);
    active = Math.max(active, pool.totalCount - pool.idleCount);
  }, 5);
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        const i = next++,
          t = performance.now();
        try {
          const result = await fn(i);
          const k = typeof result === "string" ? result : "ok";
          outcomes[k] = (outcomes[k] ?? 0) + 1;
        } catch (e) {
          failed++;
          const key = e instanceof Error ? e.message.slice(0, 120) : "unknown";
          errors[key] = (errors[key] ?? 0) + 1;
        }
        latencies.push(performance.now() - t);
      }
    }),
  );
  const seconds = (performance.now() - start) / 1000;
  clearInterval(timer);
  lag.disable();
  const result = {
    name,
    concurrency,
    requests,
    failed,
    outcomes,
    requestsPerSecond: +(requests / seconds).toFixed(1),
    ...summary(latencies),
    poolWaitingPeak: waiting,
    databaseConnectionsPeak: active,
    eventLoopP99Ms: +(lag.percentile(99) / 1e6).toFixed(2),
  };
  observations.push(result);
  console.log(JSON.stringify(result));
}
try {
  if (process.env.JANITOR_BENCHMARK_REUSE !== "1") {
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await query(`CREATE SCHEMA ${schema}`);
    for (const name of (
      await readdir(new URL("packages/storage/postgres/migrations/", root))
    )
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await query(
        await readFile(
          new URL(`packages/storage/postgres/migrations/${name}`, root),
          "utf8",
        ),
      );
    await query(
      `INSERT INTO identity_subjects SELECT 'sub_'||lpad(to_hex(i),64,'0'),'person',jsonb_build_object('id','sub_'||lpad(to_hex(i),64,'0'),'kind','person','updatedAt',$1::bigint) FROM generate_series(1,100001) i`,
      [Date.now()],
    );
    await query(
      `INSERT INTO visitors SELECT 'vis_'||lpad(to_hex(i),48,'0'),$1::bigint,$1::bigint FROM generate_series(1,10000) i`,
      [Date.now()],
    );
    // Seed one genuine API event to obtain the actual application-scoped key.
    await evidence.record({
      id: "scope-seed",
      type: "login-failure",
      subjectId: subject(1),
    });
    const scope = (await query("SELECT scope FROM application_events LIMIT 1"))
      .rows[0].scope as string;
    const now = Date.now();
    console.log(
      `Seeding ${count} synthetic events: half in one hot account, half across 100,000 accounts.`,
    );
    // Batches avoid one enormous transaction; maintenance/durability stay enabled.
    for (let start = 1; start <= count; start += 50_000) {
      await query(
        `INSERT INTO application_events (id,scope,digest,subject_id,action,occurred_at,expires_at,record)
      SELECT id,$3,'synthetic',sid,action,$4::bigint - i % 600000,$4::bigint + 604800000,
        jsonb_build_object('id',id,'scope',$3::text,'digest','synthetic','subjectId',sid,'action',action,'type','login-failure','occurredAt',$4::bigint-i%600000,'expiresAt',$4::bigint+604800000)
      FROM (SELECT i,'seed_'||i id,'sub_'||lpad(to_hex(CASE WHEN i <= $5::integer/2 THEN 1 ELSE 2+i%100000 END),64,'0') sid,
        CASE WHEN i%5=0 THEN 'payment' ELSE 'sign-in' END action FROM generate_series($1::integer,$2::integer) i) seed`,
        [start, Math.min(start + 49_999, count), scope, now, count],
      );
      if (start % 250000 === 1)
        console.log(`Seeded ${Math.min(start + 49_999, count)} events`);
    }
    const maintenance = await pool.connect();
    try {
      await maintenance.query("SET lock_timeout='30s'");
      await maintenance.query("SET statement_timeout='120s'");
      await maintenance.query("VACUUM (ANALYZE) application_events");
    } finally {
      await maintenance.query("RESET lock_timeout; RESET statement_timeout");
      maintenance.release();
    }
  }
  const counts = (
    await query(
      "SELECT count(*)::integer events, count(DISTINCT subject_id)::integer subjects FROM application_events",
    )
  ).rows[0];
  const plans: Record<string, unknown> = {};
  const tracked = createEvidence(
    createPostgresEvidenceStorage({
      query: async (sql, args) => {
        plans.last = (
          await query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, args)
        ).rows[0]["QUERY PLAN"];
        return query(sql, args);
      },
    }),
    identity,
  );
  await tracked.velocity({ subjectId: subject(1), action: "sign-in" });
  plans.hot = plans.last;
  await tracked.velocity({ subjectId: subject(1000), action: "sign-in" });
  plans.sparse = plans.last;
  delete plans.last;
  const runId = crypto.randomUUID();
  for (const concurrency of [1, 16, 64, 256]) {
    await load("event-insert", concurrency, (i) =>
      evidence.record({
        id: `${runId}-${concurrency}-${i}`,
        type: "login-failure",
        subjectId: subject(2 + (i % 100000)),
        sessionId: `synthetic-${i}`,
        action: "sign-in",
      }),
    );
    await load("velocity-sparse", concurrency, (i) =>
      evidence.velocity({
        subjectId: subject(2 + (i % 100000)),
        action: "sign-in",
      }),
    );
    await load(
      "velocity-hot",
      concurrency,
      async () =>
        (await evidence.velocity({ subjectId: subject(1), action: "sign-in" }))
          .saturated
          ? "saturated"
          : "complete",
      Math.min(samples, 256),
    );
    const protection = createProtection(
      protectionStore,
      {
        ...identity,
        namespace: `${runId}-${concurrency}`,
        requests: { global: 1_000_000, ...(shards > 1 ? { shards } : {}) },
      },
      100,
    );
    await load("shared-global-quota", concurrency, async () =>
      (await protection.admit()).allowed ? "admitted" : "limited",
    );
    const full = createProtection(
      protectionStore,
      {
        ...identity,
        namespace: `${runId}-full-${concurrency}`,
        requests: { global: 1, windowMs: 3_600_000 },
      },
      100,
    );
    await full.admit();
    await load("exhausted-global-quota", concurrency, async () =>
      (await full.admit()).allowed ? "admitted" : "limited",
    );
  }
  const protection = createProtection(
    protectionStore,
    {
      ...identity,
      namespace: `${runId}-ai`,
      evaluator: { maxCalls: 20, maxConcurrent: 4, windowMs: 3_600_000 },
    },
    100,
  );
  let calls = 0;
  const evaluator = protection.wrap({
    evaluate: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { sameVisitor: 0.99, automation: 0, suspicious: 0 };
    },
  });
  await load("evaluator-admission-mocked-5ms", 256, async () => {
    try {
      await evaluator.evaluate({
        history: [],
        current: normalizeObservation({}),
        deterministicSimilarity: 0,
      });
      return "evaluated";
    } catch {
      return "unavailable";
    }
  });
  if (calls > 20) throw Error("Shared evaluator budget exceeded");
  const links = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      evidence.linkDevice({
        subjectId: subject(2 + i),
        visitorId: visitor(1 + i),
        verification: {
          method: "passkey",
          issuer: "benchmark",
          eventId: `${runId}-${i}`,
          verifiedAt: Date.now(),
        },
        expiresAt: Date.now() + 86400000,
      }),
    ),
  );
  await load("device-association-read", 64, (i) =>
    evidence.assessDevice({
      id: links[i % 100]!.id,
      subjectId: links[i % 100]!.subjectId,
      visitorId: links[i % 100]!.visitorId,
    }),
  );
  const size = (
    await query(
      "SELECT pg_total_relation_size('application_events')::float8 bytes",
    )
  ).rows[0];
  const result = {
    recordedAt: new Date().toISOString(),
    label,
    source: "synthetic; no accuracy or paid AI measurement",
    machine: {
      cpu: cpus()[0]?.model,
      hostMemoryBytes: totalmem(),
      database:
        "local Docker PostgreSQL 17; 2 CPU limit, 1 GiB memory limit, shared_buffers=128MB, pool=8",
    },
    postgres: (await query("SELECT version()")).rows[0].version,
    data: { ...counts, ...size },
    shards,
    mockedEvaluatorCalls: calls,
    observations,
    errors,
    plans,
    limitations: [
      "Closed-loop load, local network, shared developer host; not a production throughput SLA.",
      "Hot reads intentionally saturate at 1000 returned events; counts are lower bounds.",
      "Rows are synthetic; the seed bypasses API hashing, while measured writes use the production API.",
      "No D1 throughput or real Jev inference capacity is measured.",
    ],
  };
  await mkdir(new URL("docs/benchmarks/", root), { recursive: true });
  await writeFile(
    new URL(`docs/benchmarks/security-${label}.json`, root),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(`Saved security-${label}.json; ${calls} mock evaluator starts.`);
} finally {
  await pool.end();
}
