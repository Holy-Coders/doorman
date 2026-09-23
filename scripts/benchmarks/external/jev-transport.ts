import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { unwrapCloudflareJevResponse } from "../../../packages/evaluators/cloudflare-jev/src/index.js";
import { readJSON } from "../../../packages/network/src/http.js";

const resultSchema = z.object({
  model: z.literal("jev-1.13.0"),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("noul"),
      noul: z.number().finite().min(0).max(1),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export type PilotResult = z.infer<typeof resultSchema>;
const ledgerSchema = z.object({
  attempts: z.number().int().min(0).max(120),
  inputBytes: z.number().int().nonnegative(),
  entries: z.record(
    z.string().regex(/^[a-f0-9]{64}$/),
    z.object({
      result: resultSchema,
      latencyMs: z.number().int().nonnegative(),
    }),
  ),
});
type Ledger = z.infer<typeof ledgerSchema>;
export function requestDigest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
/** Separate research allowance. Reservations survive failures/restarts; no automatic retry. */
export async function createPilotTransport(options: {
  path: string;
  maxCalls: number;
  live: boolean;
  token?: string;
  accountId?: string;
  fetch?: typeof fetch;
}) {
  if (
    !Number.isInteger(options.maxCalls) ||
    options.maxCalls < 0 ||
    options.maxCalls > 120
  )
    throw new Error("Pilot call allowance must be between 0 and 120");
  await mkdir(`${options.path}.lock`); // Exclusive across processes. Never silently recover a stale lock.
  let ledger: Ledger;
  try {
    try {
      ledger = ledgerSchema.parse(
        JSON.parse(await readFile(options.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ledger = { attempts: 0, inputBytes: 0, entries: {} };
    }
    if (Object.keys(ledger.entries).length > ledger.attempts)
      throw new Error("Invalid pilot ledger");
  } catch (error) {
    await rm(`${options.path}.lock`, { recursive: true });
    throw error;
  }
  const save = async () => {
    const tmp = `${options.path}.tmp`;
    await writeFile(tmp, JSON.stringify(ledger), { mode: 0o600 });
    await rename(tmp, options.path);
  };
  let inFlight = false;
  return {
    async evaluate(input: unknown): Promise<PilotResult> {
      if (inFlight) throw new Error("Pilot requests must run sequentially");
      inFlight = true;
      try {
        const key = requestDigest(input);
        const cached = ledger.entries[key];
        if (cached) return resultSchema.parse(cached.result);
        if (!options.live)
          throw new Error(
            "Uncached Jev case: use --live with an explicit --max-calls allowance",
          );
        if (!options.token || !/^[a-f0-9]{32}$/.test(options.accountId ?? ""))
          throw new Error("Cloudflare credentials required");
        const inputBytes = Buffer.byteLength(JSON.stringify(input));
        if (inputBytes > 32768 || ledger.attempts >= options.maxCalls)
          throw new Error("Pilot request or cumulative call cap reached");
        ledger.attempts++;
        ledger.inputBytes += inputBytes;
        await save();
        const started = performance.now();
        const response = await (options.fetch ?? fetch)(
          `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: {
              Authorization: `Bearer ${options.token}`,
              "Content-Type": "application/json",
              "cf-aig-gateway-id": "default",
              "cf-aig-collect-log": "false",
              "cf-aig-collect-log-payload": "false",
              "cf-aig-skip-cache": "true",
              "cf-aig-max-attempts": "1",
            },
            body: JSON.stringify({ model: "typesafe/jev", input }),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(
            `Jev pilot HTTP ${response.status}; attempt remains reserved`,
          );
        }
        const envelope = (await readJSON(response.body, 32768, 15000)) as {
          success?: boolean;
          result?: unknown;
        };
        if (!envelope.success)
          throw new Error(
            "Jev pilot provider failure; attempt remains reserved",
          );
        const result = resultSchema.parse(
          unwrapCloudflareJevResponse(envelope.result),
        );
        ledger.entries[key] = {
          result,
          latencyMs: Math.round(performance.now() - started),
        };
        await save();
        return result;
      } finally {
        inFlight = false;
      }
    },
    summary() {
      const entries = Object.values(ledger.entries),
        times = entries.map((e) => e.latencyMs).sort((a, b) => a - b);
      return {
        attempts: ledger.attempts,
        completed: entries.length,
        inputBytes: ledger.inputBytes,
        inputTokens: entries.reduce(
          (sum, e) => sum + e.result.usage.input_tokens,
          0,
        ),
        outputTokens: entries.reduce(
          (sum, e) => sum + e.result.usage.output_tokens,
          0,
        ),
        p50LatencyMs: times[Math.floor(times.length * 0.5)] ?? null,
        p95LatencyMs:
          times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ??
          null,
        aboveDefault1200ms: times.filter((t) => t > 1200).length,
      };
    },
    close: () => rm(`${options.path}.lock`, { recursive: true }),
  };
}
