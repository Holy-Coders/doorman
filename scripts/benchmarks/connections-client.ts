import { createConnection, type Socket } from "node:net";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
// Restricted to a local Docker network/loopback. No arbitrary load-test target.
const host = process.env.JANITOR_BENCHMARK_HOST ?? "janitor-capacity-server";
if (!["janitor-capacity-server", "127.0.0.1", "localhost"].includes(host))
  throw Error("Local benchmark only");
const target = Number(process.env.JANITOR_BENCHMARK_CONNECTIONS ?? 200_000);
const workers = Number(process.env.JANITOR_BENCHMARK_WORKERS ?? 8);
if (
  !Number.isInteger(target) ||
  target < 100 ||
  target > 250_000 ||
  !Number.isInteger(workers) ||
  workers < 1 ||
  workers > 16
)
  throw Error("Invalid benchmark bounds");
const sockets: Peer[] = [];
let unexpectedCloses = 0,
  phase = "ramp",
  closing = false;
const errors: Record<string, number> = {};
class Peer {
  socket: Socket;
  buffer = Buffer.alloc(0);
  pending?: {
    resolve: (status: number) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(readonly i: number) {
    this.socket = createConnection({ host, port: 3000 + (i % workers) });
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk) => {
      this.buffer = this.buffer.length
        ? Buffer.concat([this.buffer, chunk])
        : chunk;
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = this.buffer.subarray(0, end).toString();
      const length = Number(header.match(/content-length: (\d+)/i)?.[1] ?? 0);
      if (this.buffer.length < end + 4 + length) return;
      const status = Number(header.split(" ")[1]);
      this.buffer = this.buffer.subarray(end + 4 + length);
      const p = this.pending;
      this.pending = undefined;
      if (p) {
        clearTimeout(p.timer);
        p.resolve(status);
      }
    });
    this.socket.on("error", (e) => {
      errors[e.message] = (errors[e.message] ?? 0) + 1;
      this.fail(e);
    });
    this.socket.on("close", () => {
      if (!closing) unexpectedCloses++;
      this.fail(Error("Connection closed"));
    });
  }
  fail(e: Error) {
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearTimeout(p.timer);
      p.reject(e);
    }
  }
  async request(text: string): Promise<number> {
    if (this.pending || this.socket.destroyed)
      throw Error("Unavailable connection");
    return new Promise((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.fail(Error("Response timeout"));
          this.socket.destroy();
        }, 120_000),
      };
      this.socket.write(text);
    });
  }
}
const readStats = async () =>
  Promise.all(
    Array.from({ length: workers }, async (_, i) => {
      const r = await fetch(`http://${host}:${3000 + i}/stats`);
      if (!r.ok) throw Error("Stats unavailable");
      return r.json();
    }),
  );
const summary = (values: number[]) => {
  const a = values.sort((a, b) => a - b);
  const q = (p: number) =>
    +(a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0).toFixed(2);
  return { p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: q(1) };
};
const stages: unknown[] = [];
const signals = {
  userAgent: "Mozilla/5.0 Chrome/140.0",
  platform: "Win32",
  languages: ["en-US"],
  timezone: "UTC",
  screen: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
  viewport: { width: 1200, height: 720 },
  hardware: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 },
  graphics: { webglVendor: "benchmark", webglRenderer: "masked" },
};
const body = JSON.stringify({ signals });
const post = (i: number) =>
  `POST /api/visitor HTTP/1.1\r\nHost: localhost:${3000 + (i % workers)}\r\nContent-Type: application/json\r\nCookie: __visitor=vis_${(1 + (i % 10000)).toString(16).padStart(48, "0")}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: keep-alive\r\n\r\n${body}`;
const started = new Date().toISOString();
let failure: string | undefined;
try {
  for (const step of [
    ...new Set([
      Math.min(target, 10_000),
      Math.min(target, 50_000),
      Math.min(target, 100_000),
      target,
    ]),
  ]) {
    let next = sockets.length;
    const begin = performance.now();
    await Promise.all(
      Array.from({ length: 128 }, async () => {
        while (next < step) {
          const i = next++;
          const peer = new Peer(i);
          sockets.push(peer);
          const status = await peer.request(
            `GET /ready HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n`,
          );
          if (status !== 200) throw Error(`Warmup status ${status}`);
        }
      }),
    );
    const stats = await readStats();
    const live = sockets.filter((p) => !p.socket.destroyed).length;
    const result = {
      phase: "ramp",
      target: step,
      clientLive: live,
      seconds: +((performance.now() - begin) / 1000).toFixed(2),
      server: stats,
      clientRssBytes: process.memoryUsage().rss,
    };
    stages.push(result);
    console.log(JSON.stringify(result));
    if (live !== step) throw Error("Connections closed during ramp");
  }
  // Hold all connections while making actual Janitor requests at a declared open-loop rate.
  phase = "steady";
  const rates = (process.env.JANITOR_BENCHMARK_RATES ?? "100")
    .split(",")
    .map(Number);
  const durationSeconds = 15;
  if (
    rates.length > 6 ||
    rates.some((rate) => !Number.isInteger(rate) || rate < 1 || rate > 10000)
  )
    throw Error("Invalid offered rates");
  for (const rate of rates) {
    let missedSchedule = 0;
    const outstanding = new Set<Promise<void>>();
    const statuses: Record<string, number> = {};
    const latencies: number[] = [];
    const successLatencies: number[] = [];
    const begin = performance.now();
    for (let n = 0; n < rate * durationSeconds; n++) {
      const due = begin + (n * 1000) / rate,
        delay = due - performance.now();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      else if (delay < -1000 / rate) missedSchedule++;
      const peer = sockets[(n * 101) % sockets.length]!;
      const t = performance.now();
      const job: Promise<void> = peer
        .request(post(peer.i))
        .then(
          (status) => {
            statuses[status] = (statuses[status] ?? 0) + 1;
            latencies.push(performance.now() - t);
            if (status === 200) successLatencies.push(performance.now() - t);
          },
          () => {
            statuses.transportError = (statuses.transportError ?? 0) + 1;
          },
        )
        .finally(() => outstanding.delete(job));
      outstanding.add(job);
    }
    await Promise.all(outstanding);
    stages.push({
      phase,
      offeredRps: rate,
      scheduled: rate * durationSeconds,
      missedSchedule,
      statuses,
      ...summary(latencies),
      successLatency: summary(successLatencies),
      completedRps: +(
        (statuses[200] ?? 0) /
        ((performance.now() - begin) / 1000)
      ).toFixed(1),
      clientLive: sockets.filter((p) => !p.socket.destroyed).length,
      server: await readStats(),
    });
    console.log(JSON.stringify(stages.at(-1)));
  }
  // One simultaneous measurement per open connection. Successful work and overload are separate outcomes.
  phase = "burst";
  const burstStatuses: Record<string, number> = {};
  const burstLatency: number[] = [];
  const burstStart = performance.now();
  await Promise.all(
    sockets.map(async (peer) => {
      const t = performance.now();
      try {
        const status = await peer.request(post(peer.i));
        burstStatuses[status] = (burstStatuses[status] ?? 0) + 1;
      } catch {
        burstStatuses.transportError = (burstStatuses.transportError ?? 0) + 1;
      }
      burstLatency.push(performance.now() - t);
    }),
  );
  stages.push({
    phase,
    offeredRequests: sockets.length,
    seconds: +((performance.now() - burstStart) / 1000).toFixed(2),
    statuses: burstStatuses,
    ...summary(burstLatency),
    clientLive: sockets.filter((p) => !p.socket.destroyed).length,
    server: await readStats(),
    clientRssBytes: process.memoryUsage().rss,
  });
  console.log(JSON.stringify(stages.at(-1)));
  phase = "recovery";
  await new Promise((r) => setTimeout(r, 1000));
  const recovery: Record<string, number> = {};
  for (const peer of sockets.slice(0, 100)) {
    const status = await peer.request(post(peer.i));
    recovery[status] = (recovery[status] ?? 0) + 1;
  }
  stages.push({ phase, statuses: recovery, server: await readStats() });
  console.log(JSON.stringify(stages.at(-1)));
} catch (e) {
  failure = e instanceof Error ? e.message : String(e);
  console.error(failure);
  process.exitCode = 1;
} finally {
  const result = {
    started,
    finished: new Date().toISOString(),
    node: process.version,
    target,
    workers,
    phase,
    failure,
    unexpectedCloses,
    errors,
    stages,
    limitations: [
      "HTTP/1.1 over an isolated local Docker network, without TLS or a production load balancer.",
      "Open keep-alive capacity differs from completed identity throughput; 503 is shed work, not successful identity.",
      "Eight Node processes, eight database connections, 64 admitted measurements total; no real Jev inference.",
      "The load generator shares the developer host and can bottleneck; offered scheduling delay and transport errors are reported.",
    ],
  };
  await writeFile(
    process.env.JANITOR_BENCHMARK_OUTPUT ??
      `/results/connections-${target}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  closing = true;
  for (const p of sockets) p.socket.destroy();
}
