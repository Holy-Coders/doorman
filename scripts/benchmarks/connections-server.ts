import cluster from "node:cluster";
import { createServer } from "node:http";
import { createNodeRequestListener } from "@janitor/adapters/node/http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import pg from "pg";
import { createNodeVisitor } from "@janitor/adapters/node";
import { normalizeObservation } from "@janitor/core";

const workers = Number(process.env.JANITOR_BENCHMARK_WORKERS ?? 8);
const database = process.env.JANITOR_BENCHMARK_DATABASE_URL;
if (
  !database ||
  !["127.0.0.1", "localhost", "janitor-capacity-pg"].includes(
    new URL(database).hostname,
  ) ||
  !Number.isInteger(workers) ||
  workers < 1 ||
  workers > 16
)
  throw Error("Benchmark requires an isolated local database and 1–16 workers");
export const signals = {
  userAgent: "Mozilla/5.0 Chrome/140.0",
  platform: "Win32",
  languages: ["en-US"],
  timezone: "UTC",
  screen: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
  viewport: { width: 1200, height: 720 },
  hardware: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 },
  graphics: { webglVendor: "benchmark", webglRenderer: "masked" },
};
if (cluster.isPrimary) {
  const db = new pg.Pool({
    connectionString: database,
    max: 1,
    options: "-c search_path=janitor_security_benchmark",
  });
  // Reproducible known cookies. They represent 10,000 indistinguishable browsers, not accuracy labels.
  await db.query("DELETE FROM observations");
  await db.query(
    "INSERT INTO observations (visitor_id,seen_at,platform,browser,timezone,webgl_renderer,signals_json) SELECT id,$1,'windows','chrome','utc','masked',$2::jsonb FROM visitors",
    [Date.now(), JSON.stringify(normalizeObservation(signals))],
  );
  await db.end();
  for (let i = 0; i < workers; i++)
    cluster.fork({ JANITOR_BENCHMARK_WORKER: String(i) });
  cluster.on("exit", (worker, code, signal) => {
    if (code || signal) {
      console.error(
        JSON.stringify({
          event: "benchmark-worker-exit",
          worker: worker.id,
          code,
          signal,
        }),
      );
      process.exitCode = 1;
    }
  });
} else {
  const worker = Number(process.env.JANITOR_BENCHMARK_WORKER);
  const port = 3000 + worker;
  const pool = new pg.Pool({
    connectionString: database,
    max: 1,
    connectionTimeoutMillis: 500,
    options:
      "-c search_path=janitor_security_benchmark -c statement_timeout=2000 -c lock_timeout=1000",
  });
  let open = 0,
    peakOpen = 0,
    overloads = 0,
    completed = 0,
    failures = 0,
    poolWaitingPeak = 0,
    dbPeak = 0;
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  const visitor = createNodeVisitor({
    db: pool,
    maxInFlightRequests: 8,
    onOverload: () => {
      overloads++;
    },
    protection: {
      secret: "synthetic-connection-benchmark-only-".repeat(2),
      namespace: "connections",
      requests: { global: 1_000_000, shards: 32 },
    },
    evaluator: false,
  });
  setInterval(() => {
    poolWaitingPeak = Math.max(poolWaitingPeak, pool.waitingCount);
    dbPeak = Math.max(dbPeak, pool.totalCount);
  }, 10).unref();
  const handleNode = createNodeRequestListener(visitor, {
    origin: `http://localhost:${port}`,
    maxInFlightRequests: 8,
    onOverload: () => {
      overloads++;
    },
    onResponse: (status) => {
      if (status === 200) completed++;
      else if (status !== 503) failures++;
    },
  });
  const server = createServer((req, res) => {
    const send = (
      status: number,
      body: string,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        ...headers,
      });
      res.end(body);
    };
    if (req.url === "/ready") return send(200, '{"ready":true}');
    if (req.url === "/stats")
      return send(
        200,
        JSON.stringify({
          worker,
          open,
          peakOpen,
          overloads,
          completed,
          failures,
          poolWaitingPeak,
          dbPeak,
          rssBytes: process.memoryUsage().rss,
          heapBytes: process.memoryUsage().heapUsed,
          eventLoopP99Ms: lag.percentile(99) / 1e6,
        }),
      );
    if (req.url !== "/api/visitor") return send(404, "{}");
    handleNode(req, res);
  });
  server.on("connection", (socket) => {
    open++;
    peakOpen = Math.max(peakOpen, open);
    socket.on("close", () => open--);
  });
  // Deliberately long for the connection-capacity experiment; not a production timeout recommendation.
  server.keepAliveTimeout = 600_000;
  server.headersTimeout = 30_000;
  server.requestTimeout = 30_000;
  server.listen(port, "0.0.0.0", () =>
    console.log(
      JSON.stringify({ ready: true, worker, port, node: process.version }),
    ),
  );
}
