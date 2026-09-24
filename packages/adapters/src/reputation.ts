import { z } from "zod";
import type {
  ReputationEvidence,
  RiskEvidence,
} from "@aarondovturkel/doorman-core";
import { createSubjectLinker, type SubjectLinkingOptions } from "./subject.js";

export type ReputationOptions = {
  /** Enables sharing the server-resolved client IP with AbuseIPDB. */
  apiKey: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  /** Shared database budget in server adapters; also set the provider account quota. */
  maxRequestsPerHour?: number;
};
const probability = z.number().finite().min(0).max(1);
export const riskEvidenceSchema = z.strictObject({
  edge: z
    .strictObject({
      source: z.literal("edge"),
      provider: z.string().max(64),
      observedAt: z.number().int().nonnegative(),
      botScore: z.number().int().min(1).max(99).optional(),
      verifiedBot: z.boolean().optional(),
      signedAgent: z.boolean().optional(),
      ja4: z
        .string()
        .regex(/^[tqd][a-z0-9]{9}_[a-f0-9]{12}_[a-f0-9]{12}$/)
        .optional(),
    })
    .optional(),
  activity: z
    .strictObject({
      windowMs: z.number().int().min(1000).max(86_400_000),
      requests: z.number().int().min(0).max(1_000_000),
      denials: z.number().int().min(0).max(1_000_000),
      authenticationFailures: z.number().int().min(0).max(1_000_000),
    })
    .refine(
      (a) => a.denials <= a.requests && a.authenticationFailures <= a.requests,
    )
    .optional(),
  reputation: z
    .strictObject({
      provider: z.literal("abuseipdb"),
      status: z.enum(["available", "unavailable", "limited", "not-requested"]),
      observedAt: z.number().int().nonnegative(),
      cached: z.boolean(),
      score: probability.optional(),
      totalReports: z
        .number()
        .int()
        .nonnegative()
        .max(1_000_000_000)
        .optional(),
      lastReportedAt: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export function trustedRiskEvidence(
  input?: RiskEvidence,
): RiskEvidence | undefined {
  if (!input) return undefined;
  const result = riskEvidenceSchema.parse(input);
  const now = Date.now();
  if (
    result.edge &&
    (result.edge.observedAt > now + 5000 ||
      result.edge.observedAt < now - 300_000)
  )
    delete result.edge;
  if (
    result.reputation &&
    (result.reputation.observedAt > now + 5000 ||
      result.reputation.observedAt < now - 3_600_000)
  )
    delete result.reputation;
  return result;
}

function publicIp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (z.ipv4().safeParse(value).success) {
    const [a, b] = value.split(".").map(Number) as [number, number];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
      return undefined;
    return value;
  }
  if (z.ipv6().safeParse(value).success && /^[23][a-f0-9]{0,3}:/i.test(value))
    return new URL(`https://[${value}]/`).hostname.slice(1, -1);
  return undefined;
}

/** Read-only reputation enrichment. Raw IPs never enter the cache, result, database or Jev. */
export function createReputation(
  options: ReputationOptions,
  identity: SubjectLinkingOptions,
  admit?: () => Promise<boolean>,
) {
  const config = z
    .strictObject({
      apiKey: z.string().trim().min(1).max(4096),
      timeoutMs: z.number().int().min(50).max(3000).default(500),
      cacheTtlMs: z.number().int().min(1000).max(3_600_000).default(300_000),
      maxRequestsPerHour: z.number().int().min(1).max(10_000).default(100),
    })
    .parse(options);
  const label = createSubjectLinker(identity);
  const cache = new Map<
    string,
    { expires: number; value: ReputationEvidence }
  >();
  const pending = new Map<string, Promise<ReputationEvidence>>();
  let period = 0,
    calls = 0;
  const empty = (status: ReputationEvidence["status"]): ReputationEvidence => ({
    provider: "abuseipdb",
    status,
    observedAt: Date.now(),
    cached: false,
  });
  return {
    async check(value?: string): Promise<ReputationEvidence> {
      const ip = publicIp(value);
      if (!ip) return empty("not-requested");
      const key = await label(JSON.stringify(["reputation-v1", ip]));
      const found = cache.get(key);
      if (found && found.expires > Date.now())
        return { ...found.value, cached: true };
      if (pending.has(key))
        return { ...(await pending.get(key)!), cached: true };
      const hour = Math.floor(Date.now() / 3_600_000);
      if (hour !== period) {
        period = hour;
        calls = 0;
      }
      if (calls >= config.maxRequestsPerHour || pending.size >= 8)
        return empty("limited");
      calls++;
      const work = (async () => {
        let result = empty("unavailable");
        try {
          if (admit && !(await admit())) return empty("limited");
          const url = new URL("https://api.abuseipdb.com/api/v2/check");
          url.searchParams.set("ipAddress", ip);
          url.searchParams.set("maxAgeInDays", "30");
          const response = await fetch(url, {
            headers: { Key: config.apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(config.timeoutMs),
            redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("Reputation unavailable");
          }
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Empty reputation response");
          const decoder = new TextDecoder();
          let text = "",
            size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 8192) throw new Error("Reputation response too large");
              text += decoder.decode(value, { stream: true });
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
          const raw: unknown = JSON.parse(text + decoder.decode());
          const data = z
            .object({
              data: z.object({
                ipAddress: z.string(),
                isPublic: z.literal(true),
                abuseConfidenceScore: z.number().int().min(0).max(100),
                totalReports: z.number().int().min(0).max(1_000_000_000),
                lastReportedAt: z.string().max(64).nullable().optional(),
              }),
            })
            .parse(raw).data;
          if (publicIp(data.ipAddress) !== ip)
            throw new Error("Reputation address mismatch");
          const last = data.lastReportedAt
            ? Date.parse(data.lastReportedAt)
            : undefined;
          result = {
            ...empty("available"),
            score: data.abuseConfidenceScore / 100,
            totalReports: data.totalReports,
            ...(last !== undefined &&
            Number.isFinite(last) &&
            last >= 0 &&
            last <= Date.now() + 5000
              ? { lastReportedAt: last }
              : {}),
          };
        } catch {
          /* Optional enrichment never interrupts identity. */
        }
        if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
        cache.set(key, {
          expires:
            Date.now() +
            (result.status === "available" ? config.cacheTtlMs : 30_000),
          value: result,
        });
        return result;
      })();
      pending.set(key, work);
      try {
        return await work;
      } finally {
        pending.delete(key);
      }
    },
  };
}
