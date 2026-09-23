import { readFile, writeFile, mkdir } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import pg from "pg";
import { createPostgresStorage } from "@janitor/storage-postgres";
import { createVisitorEngine, type NormalizedObservation } from "@janitor/core";

// Explicit local opt-in. Only this script's isolated schema is created/dropped.
const connectionString = process.env.JANITOR_BENCHMARK_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set JANITOR_BENCHMARK_DATABASE_URL to a disposable local Postgres database.",
  );
const address = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
  throw new Error("The scale benchmark only runs against a local database.");
const observationsPerVisitor = Number(
  process.env.JANITOR_BENCHMARK_HISTORY ?? 1,
);
if (
  !Number.isInteger(observationsPerVisitor) ||
  observationsPerVisitor < 1 ||
  observationsPerVisitor > 10
)
  throw new Error("Choose 1–10 observations per visitor.");
const count = Number(process.env.JANITOR_BENCHMARK_VISITORS ?? 2_000_000);
if (!Number.isSafeInteger(count) || count < 1000 || count > 5_000_000)
  throw new Error("Choose 1000–5000000 visitors.");
const pool = new pg.Pool({
  connectionString,
  max: 10,
  options: "-c search_path=janitor_scale_benchmark -c statement_timeout=600000",
});
const query = (text: string, values?: unknown[]) => pool.query(text, values);
const root = new URL("../", import.meta.url);
const timed = async <T>(fn: () => Promise<T>) => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
};
const summarize = (samples: number[]) => {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    Number(s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2));
  return { samples: s.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
};
try {
  await query("DROP SCHEMA IF EXISTS janitor_scale_benchmark CASCADE");
  await query("CREATE SCHEMA janitor_scale_benchmark");
  await query(
    await readFile(
      new URL("packages/storage/postgres/migrations/0001_visitors.sql", root),
      "utf8",
    ),
  );
  const now = Date.now();
  console.log(
    `Seeding ${count.toLocaleString()} synthetic visitors in isolated local schema...`,
  );
  const seed = await timed(async () => {
    await query(
      `INSERT INTO visitors SELECT 'vis_' || lpad(to_hex(i),48,'0'), $2::bigint - 86400000, $2::bigint - 86400000 + i FROM generate_series(1,$1::integer) i`,
      [count, now],
    );
    // 80% identical common-browser traffic; 20% a reproducible diverse tail.
    // These invented profiles test indexed retrieval, not real identity accuracy.
    await query(
      `INSERT INTO observations (visitor_id, seen_at, platform, browser, timezone, webgl_renderer, signals_json)
      SELECT 'vis_' || lpad(to_hex(i),48,'0'), $2::bigint - 86400000 + i, platform, browser, timezone, renderer,
        jsonb_build_object('platform',platform,'browser',browser,'timezone',timezone,
          'screen',jsonb_build_object('width',width,'height',height,'colorDepth',24,'pixelRatio',1),
          'hardware',jsonb_build_object('hardwareConcurrency',cores,'deviceMemory',8,'maxTouchPoints',0),
          'graphics',jsonb_build_object('webglVendor','benchmark','webglRenderer',renderer),
          'languages',jsonb_build_array('en-us'),'viewport',jsonb_build_object('width',1200,'height',720))
      FROM (SELECT i,
        CASE WHEN i % 5 <> 0 THEN 'windows' ELSE (ARRAY['windows','macos','linux'])[1 + i/5 % 3] END platform,
        CASE WHEN i % 5 <> 0 THEN 'chrome' ELSE (ARRAY['chrome','firefox','edge'])[1 + i/15 % 3] END browser,
        CASE WHEN i % 5 <> 0 THEN 'UTC' ELSE 'Synthetic/Zone-' || (i/45 % 64) END timezone,
        CASE WHEN i % 5 <> 0 THEN 'masked' ELSE 'synthetic-gpu-' || (i/2880 % 256) END renderer,
        CASE WHEN i % 5 <> 0 THEN 1080 ELSE (ARRAY[768,900,1080,1200,1440,1600])[1 + i/737280 % 6] END width,
        CASE WHEN i % 5 <> 0 THEN 1920 ELSE (ARRAY[1366,1440,1920,1920,2560,2560])[1 + i/737280 % 6] END height,
        CASE WHEN i % 5 <> 0 THEN 8 ELSE (ARRAY[4,8,12,16])[1 + i/4423680 % 4] END cores
        FROM generate_series(1,$1::integer) i) profiles`,
      [count, now],
    );
  });
  if (observationsPerVisitor > 1) {
    console.log(
      `Adding ${observationsPerVisitor - 1} historical observations per visitor...`,
    );
    const historySeed = await timed(() =>
      query(
        `INSERT INTO observations (visitor_id, seen_at, platform, browser, timezone, webgl_renderer, signals_json)
      SELECT visitor_id, seen_at - h * 86400000::bigint, platform, browser, timezone, webgl_renderer, signals_json
      FROM observations CROSS JOIN generate_series(1,$1::integer) h`,
        [observationsPerVisitor - 1],
      ),
    );
    seed.ms += historySeed.ms;
  }
  console.log(
    `Seeded in ${(seed.ms / 1000).toFixed(1)}s; building selective indexes...`,
  );
  const index = await timed(async () =>
    query(
      await readFile(
        new URL(
          "packages/storage/postgres/migrations/0004_candidate_lookup.sql",
          root,
        ),
        "utf8",
      ),
    ),
  );
  await query("VACUUM (ANALYZE) observations");
  await query("ANALYZE visitors");
  const store = createPostgresStorage({ query });
  const captured: { sql: string; values?: unknown[] }[] = [];
  const tracked = createPostgresStorage({
    query: async (sql, values) => {
      captured.push({ sql, values });
      return query(sql, values);
    },
  });
  const targets = (
    await query(
      `SELECT visitor_id, signals_json FROM observations WHERE id % 5 = 0 AND id <= 500 ORDER BY id`,
    )
  ).rows as { visitor_id: string; signals_json: NormalizedObservation }[];
  const legacyMs: number[] = [],
    lookupMs: number[] = [],
    historyMs: number[] = [];
  let legacyFound = 0,
    found = 0,
    maxCandidates = 0;
  for (const target of targets) {
    const o = target.signals_json;
    const legacy = await timed(() =>
      query(
        `SELECT visitor_id, MAX(seen_at) FROM (
      (SELECT visitor_id, seen_at FROM observations WHERE platform=$1 AND browser=$2 ORDER BY seen_at DESC LIMIT 50)
      UNION ALL (SELECT visitor_id, seen_at FROM observations WHERE webgl_renderer=$3 ORDER BY seen_at DESC LIMIT 50)
      UNION ALL (SELECT visitor_id, seen_at FROM observations WHERE timezone=$4 AND browser=$2 ORDER BY seen_at DESC LIMIT 50)
      ) plausible GROUP BY visitor_id ORDER BY MAX(seen_at) DESC, visitor_id LIMIT 10`,
        [o.platform, o.browser, o.graphics?.webglRenderer, o.timezone],
      ),
    );
    legacyMs.push(legacy.ms);
    legacyFound += Number(
      legacy.value.rows.some((r) => r.visitor_id === target.visitor_id),
    );
    const match = await timed(() => store.findCandidates(o, 10));
    lookupMs.push(match.ms);
    found += Number(match.value.some((r) => r.visitorId === target.visitor_id));
    maxCandidates = Math.max(maxCandidates, match.value.length);
    historyMs.push(
      (
        await timed(() =>
          store.getRecentObservationsBatch!(
            match.value.map((r) => r.visitorId),
            5,
          ),
        )
      ).ms,
    );
  }
  const sample = targets[0]!;
  await tracked.findCandidates(sample.signals_json, 10);
  const lookupQuery = captured.at(-1)!;
  const plan = (
    await query(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + lookupQuery.sql,
      lookupQuery.values,
    )
  ).rows[0]["QUERY PLAN"];
  const flatten = (
    node: Record<string, unknown>,
  ): Record<string, unknown>[] => [
    node,
    ...((node.Plans ?? []) as Record<string, unknown>[]).flatMap(flatten),
  ];
  const nodes = flatten(plan[0].Plan);
  const planSummary = {
    executionMs: plan[0]["Execution Time"],
    returnedRows: plan[0].Plan["Actual Rows"],
    sequentialScans: nodes.filter((n) => n["Node Type"] === "Seq Scan").length,
    indexes: [...new Set(nodes.map((n) => n["Index Name"]).filter(Boolean))],
    sharedHitBlocks: plan[0].Plan["Shared Hit Blocks"],
    sharedReadBlocks: plan[0].Plan["Shared Read Blocks"],
  };
  if (planSummary.sequentialScans || Number(planSummary.returnedRows) > 606)
    throw new Error("Lookup plan exceeded its bounded index contract.");
  const workload = async (concurrency: number, requests: number) => {
    let next = 0;
    const samples: number[] = [];
    const run = await timed(() =>
      Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next < requests) {
            const target = targets[next++ % targets.length]!;
            samples.push(
              (
                await timed(async () => {
                  const candidates = await store.findCandidates(
                    target.signals_json,
                    10,
                  );
                  await store.getRecentObservationsBatch!(
                    candidates.map((r) => r.visitorId),
                    5,
                  );
                })
              ).ms,
            );
          }
        }),
      ),
    );
    return {
      concurrency,
      requests,
      ...summarize(samples),
      requestsPerSecond: Number((requests / (run.ms / 1000)).toFixed(1)),
    };
  };
  const retrieval = await workload(10, 200);
  // Exercise actual orchestration and persistence as well as the read-only lookup.
  const o = sample.signals_json;
  const input = {
    signals: {
      ...o,
      userAgent:
        o.browser === "chrome"
          ? "Chrome/140.0"
          : o.browser === "edge"
            ? "Edg/140.0"
            : "Firefox/140.0",
    },
  };
  const engine = createVisitorEngine({ storage: store });
  const missingCookie = await timed(() => engine.identify(input));
  const cookieSamples: number[] = [];
  for (let i = 0; i < 30; i++)
    cookieSamples.push(
      (
        await timed(() =>
          engine.identify({
            ...input,
            visitorId: missingCookie.value.visitorId,
          }),
        )
      ).ms,
    );
  const common = (
    await query("SELECT signals_json FROM observations WHERE id=1")
  ).rows[0].signals_json;
  const commonIdentity = await engine.identify({
    signals: { ...common, userAgent: "Chrome/140.0" },
  });
  const size = (
    await query(
      "SELECT pg_total_relation_size('visitors')::float8 AS visitors_bytes, pg_total_relation_size('observations')::float8 AS observations_bytes",
    )
  ).rows[0];
  const result = {
    recordedAt: new Date().toISOString(),
    postgres: (await query("SELECT version()")).rows[0].version,
    machine: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      hostMemoryBytes: totalmem(),
      database: "local PostgreSQL; shared_buffers=256MB; connection pool=10",
    },
    data: {
      visitors: count,
      initialObservations: count * observationsPerVisitor,
      observationsPerVisitor,
      commonProfilePercent: 80,
      source: "synthetic; not real-world identification accuracy",
      ...size,
    },
    seedSeconds: Number((seed.ms / 1000).toFixed(1)),
    indexBuildSeconds: Number((index.ms / 1000).toFixed(1)),
    oldLookup: {
      ...summarize(legacyMs),
      targetFound: legacyFound,
      outOf: targets.length,
    },
    indexedLookup: {
      ...summarize(lookupMs),
      targetFound: found,
      outOf: targets.length,
      maxCandidates,
    },
    batchedHistory: summarize(historyMs),
    queryPlan: planSummary,
    retrieval,
    engine: {
      missingCookieMs: Number(missingCookie.ms.toFixed(2)),
      restoredExpectedId: missingCookie.value.visitorId === sample.visitor_id,
      cookie: summarize(cookieSamples),
      commonProfileAbstained: !commonIdentity.isReturning,
      evaluator: "disabled; no paid inference",
    },
    limitations: [
      "Single local database; warm-cache mixed reads; no production SLA or regional network latency.",
      "Synthetic retrieval recall is not identity accuracy. Common identical profiles intentionally abstain.",
      "Seeded history repeats each synthetic profile; it stresses storage, not real browser drift.",
      "Does not measure AI provider capacity, D1 capacity, or authenticated-account and optional learning workloads.",
    ],
  };
  await mkdir(new URL("docs/benchmarks/", root), { recursive: true });
  await writeFile(
    new URL(
      `docs/benchmarks/scale-${count}x${observationsPerVisitor}.json`,
      root,
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(
    new URL(
      `docs/benchmarks/scale-${count}x${observationsPerVisitor}-plan.json`,
      root,
    ),
    JSON.stringify(plan, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
