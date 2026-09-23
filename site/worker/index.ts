import { createVisitorHandler } from "@janitor/adapters/node";
import {
  createD1Storage,
  createD1ProtectionStorage,
} from "@janitor/storage-d1";
import type { D1Database } from "@janitor/storage-d1";
import { createCloudflareJevEvaluator } from "@janitor/evaluator-cloudflare-jev";
import type { WorkersAI } from "@janitor/evaluator-cloudflare-jev";
import type { JevRequest } from "@janitor/evaluator-jev";
import {
  createBudgetedAI,
  mergeDemoEvaluation,
  DEMO_LIMITS,
  digest,
  rows,
  signingKey,
} from "./budget.js";
import type { DemoEvaluation } from "./budget.js";

export type DemoEnv = {
  VISITORS: D1Database;
  AI: WorkersAI & {
    run(
      model: "typesafe/jev",
      input: JevRequest,
      options?: {
        gateway: {
          id: string;
          collectLog: boolean;
          skipCache: boolean;
          retries: { maxAttempts: 1 };
        };
      },
    ): Promise<unknown>;
  };
  ASSETS: { fetch(request: Request): Promise<Response> };
  PLAYGROUND_SECRET: string;
  JEV_ENABLED?: string;
};
const SESSION_COOKIE = "__janitor_playground_session";
const VISITOR_COOKIE = "__janitor_playground";
const PREFIX = "/api/playground/";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
function cookie(request: Request, name: string) {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + "="));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}
function setCookie(
  response: Response,
  name: string,
  value: string,
  seconds: number,
) {
  response.headers.append(
    "Set-Cookie",
    `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${seconds}`,
  );
}
async function sessionId(request: Request, env: DemoEnv) {
  const token = cookie(request, SESSION_COOKIE);
  if (!token || !/^[a-f0-9-]{36}\.\d{13}\.[a-f0-9]{64}$/.test(token))
    return undefined;
  const [id, expiry, signature] = token.split(".");
  if (
    Number(expiry) <= Date.now() ||
    Number(expiry) > Date.now() + DEMO_LIMITS.sessionMs
  )
    return undefined;
  const verified = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env.PLAYGROUND_SECRET),
    Uint8Array.from(signature!.match(/../g)!, (b) => parseInt(b, 16)),
    new TextEncoder().encode(`${id}.${expiry}`),
  );
  if (!verified) return undefined;
  return (
    await rows(
      env.VISITORS,
      "SELECT id FROM playground_sessions WHERE id=? AND expires_at>?",
      [id, Date.now()],
    )
  ).length
    ? id
    : undefined;
}
async function acceptedConsent(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return false;
  let count = 0,
    text = "";
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          count += value.byteLength;
          if (count > 1024) return false;
          text += decoder.decode(value, { stream: true });
        }
        const body: unknown = JSON.parse(text + decoder.decode());
        return (
          !!body &&
          typeof body === "object" &&
          Object.keys(body).length === 1 &&
          (body as { consent?: unknown }).consent === true
        );
      })(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

// A demo's recovery search can see only that signed demo session's history.
// Fuzzy matching never grants ownership of someone else's data or erasure rights.
function scopedStorage(env: DemoEnv, session: string) {
  const storage = createD1Storage(env.VISITORS, {
    observationRetentionDays: 1,
    maxObservationsPerVisitor: 5,
  });
  return {
    ...storage,
    async findCandidates(_observation: unknown, limit: number) {
      return rows<{ visitorId: string; lastSeenAt: number }>(
        env.VISITORS,
        "SELECT v.id AS visitorId,v.last_seen_at AS lastSeenAt FROM playground_visitors p JOIN visitors v ON v.id=p.visitor_id WHERE p.session_id=? ORDER BY v.last_seen_at DESC LIMIT ?",
        [session, Math.min(5, limit)],
      );
    },
    async getRecentObservations(id: string, limit: number) {
      const own = await rows(
        env.VISITORS,
        "SELECT visitor_id FROM playground_visitors WHERE session_id=? AND visitor_id=?",
        [session, id],
      );
      return own.length ? storage.getRecentObservations(id, limit) : [];
    },
    // Engine candidates already come from the session-scoped query above.
    async createVisitor() {
      const id = await storage.createVisitor();
      try {
        const claimed = await rows(
          env.VISITORS,
          `INSERT INTO playground_visitors(session_id,visitor_id) SELECT id,? FROM playground_sessions WHERE id=? AND expires_at>? AND (SELECT COUNT(*) FROM playground_visitors WHERE session_id=?) < 5 RETURNING visitor_id`,
          [id, session, Date.now(), session],
        );
        if (!claimed.length) throw new Error("Demo history full or expired");
        return id;
      } catch (error) {
        await storage.deleteVisitor(id);
        throw error;
      }
    },
  };
}

export function createPlaygroundWorker(env: DemoEnv) {
  let inFlight = 0;
  async function api(request: Request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(PREFIX.length);
    if (!["session", "identify", "forget-cookie"].includes(action))
      return json({ error: "Not found" }, 404);
    if (
      request.method !== "POST" &&
      !(action === "session" && request.method === "DELETE")
    )
      return json({ error: "Method not allowed" }, 405);
    if (
      request.headers.get("origin") !== url.origin ||
      request.headers.get("sec-fetch-site") === "cross-site" ||
      request.headers.get("x-janitor-playground") !== "1"
    )
      return json({ error: "Use the playground on this site" }, 403);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return json({ error: "JSON required" }, 415);
    if (!env.PLAYGROUND_SECRET || env.PLAYGROUND_SECRET.length < 32)
      return json({ error: "Live playground is not configured" }, 503);
    const protection = createD1ProtectionStorage(env.VISITORS);
    if (
      !(await protection.consumeQuota(
        "playground-all-requests-v1",
        120,
        60_000,
        Date.now(),
      ))
    ) {
      const response = json(
        { error: "The live playground is busy. Try again in a minute." },
        429,
      );
      response.headers.set("Retry-After", "60");
      return response;
    }
    const session = await sessionId(request, env);
    if (action === "session" && request.method === "POST") {
      if (!(await acceptedConsent(request)))
        return json({ error: "Explicit demo consent is required" }, 400);
      if (session) return json({ active: true });
      if (
        !(await protection.consumeQuota(
          "playground-starts-v1",
          300,
          DEMO_LIMITS.sessionMs,
          Date.now(),
        ))
      )
        return json(
          {
            error:
              "Today's live demo capacity is full. The local examples are still available.",
          },
          429,
        );
      const id = crypto.randomUUID(),
        expires = Date.now() + DEMO_LIMITS.sessionMs;
      await rows(
        env.VISITORS,
        "INSERT INTO playground_sessions(id,expires_at) VALUES(?,?) RETURNING id",
        [id, expires],
      );
      const token = `${id}.${expires}`;
      const response = json({ active: true });
      setCookie(
        response,
        SESSION_COOKIE,
        `${token}.${await digest(env.PLAYGROUND_SECRET, token)}`,
        DEMO_LIMITS.sessionMs / 1000,
      );
      // Starting a fresh authorized session never reuses another session's visitor cookie.
      setCookie(response, VISITOR_COOKIE, "", 0);
      return response;
    }
    if (!session)
      return json({ error: "Start a live demo session first" }, 401);
    if (action === "session") {
      const result = await env.VISITORS.batch([
        env.VISITORS.prepare(
          "DELETE FROM visitors WHERE id IN (SELECT visitor_id FROM playground_visitors WHERE session_id=?)",
        ).bind(session),
        env.VISITORS.prepare("DELETE FROM playground_sessions WHERE id=?").bind(
          session,
        ),
      ]);
      if (result.some((r) => !r.success)) throw new Error("Erasure failed");
      const response = json({ erased: true });
      for (const name of [SESSION_COOKIE, VISITOR_COOKIE])
        setCookie(response, name, "", 0);
      return response;
    }
    if (action === "forget-cookie") {
      const response = json({ forgotten: true });
      setCookie(response, VISITOR_COOKIE, "", 0);
      return response;
    }
    let evaluation: DemoEvaluation = { source: "fallback" };
    const visitor = createVisitorHandler(
      scopedStorage(env, session),
      env.JEV_ENABLED === "true"
        ? createCloudflareJevEvaluator(
            createBudgetedAI({
              db: env.VISITORS,
              // Cloudflare third-party models use the account gateway. Keep raw
              // prompts out of its logs/cache and prevent hidden provider retries.
              ai: {
                run: (model, input) =>
                  env.AI.run(model, input, {
                    gateway: {
                      id: "default",
                      collectLog: false,
                      skipCache: true,
                      retries: { maxAttempts: 1 },
                    },
                  }),
              },
              secret: env.PLAYGROUND_SECRET,
              sessionId: session,
              onEvaluation: (result) => {
                evaluation = mergeDemoEvaluation(evaluation, result);
              },
              onFailure: (reason) =>
                console.warn(
                  JSON.stringify({
                    event: "janitor-playground-evaluation",
                    reason,
                  }),
                ),
            }),
            { timeoutMs: 3500 },
          )
        : undefined,
      {
        endpointPath: PREFIX + "identify",
        environment: "production",
        cookie: { name: VISITOR_COOKIE, maxAgeDays: 1 },
        maxBodyBytes: 8192,
        lookupPlanning: false,
        evaluatorTimeoutMs: 4000,
        protection: {
          secret: env.PLAYGROUND_SECRET,
          namespace: "janitor-public-playground-v1",
          requests: { global: 60, session: 10, windowMs: 60_000 },
          evaluator: {
            maxCalls: 120,
            windowMs: 3_600_000,
            maxConcurrent: 2,
            failureThreshold: 2,
            cooldownMs: 60_000,
          },
        },
      },
      undefined,
      undefined,
      protection,
    );
    const assessment = await visitor.assess(request, {
      admission: { session },
    });
    if (!assessment.identity || !assessment.response.ok)
      return assessment.response;
    if (assessment.identity.riskStatus !== "evaluated")
      evaluation = { source: "fallback" };
    // Do not expose risk/confidence/observations, including when inference fails.
    const response = json({
      visitorId: assessment.identity.visitorId,
      isReturning: assessment.identity.isReturning,
      evaluation,
    });
    const header = assessment.response.headers.get("set-cookie");
    if (header) response.headers.set("Set-Cookie", header);
    return response;
  }
  return {
    async fetch(request: Request) {
      if (!new URL(request.url).pathname.startsWith(PREFIX))
        return env.ASSETS.fetch(request);
      if (inFlight >= 16)
        return json({ error: "Live playground is busy" }, 503);
      inFlight++;
      try {
        return await api(request);
      } catch {
        return json(
          { error: "Live playground is temporarily unavailable" },
          503,
        );
      } finally {
        inFlight--;
      }
    },
    async scheduled() {
      const now = Date.now();
      const result = await env.VISITORS.batch([
        env.VISITORS.prepare(
          "DELETE FROM visitors WHERE id IN (SELECT p.visitor_id FROM playground_visitors p JOIN playground_sessions s ON s.id=p.session_id WHERE s.expires_at<=?)",
        ).bind(now),
        env.VISITORS.prepare(
          "DELETE FROM playground_sessions WHERE expires_at<=?",
        ).bind(now),
        env.VISITORS.prepare(
          "DELETE FROM playground_cache WHERE expires_at<=?",
        ).bind(now),
      ]);
      if (result.some((r) => !r.success))
        throw new Error("Demo cleanup failed");
      // Also remove any interrupted inserts and old observations using Janitor's cleanup API.
      const storage = createD1Storage(env.VISITORS, {
        observationRetentionDays: 1,
        maxObservationsPerVisitor: 5,
      });
      let afterVisitorId: string | undefined;
      for (let page = 0; page < 10; page++) {
        const progress = await storage.cleanup({
          batchSize: 1000,
          afterVisitorId,
        });
        if (!progress) break;
        afterVisitorId = progress.nextVisitorId;
        if (!afterVisitorId && !progress.hasMoreExpired) break;
      }
      await createD1ProtectionStorage(env.VISITORS).cleanupProtection(
        now,
        1000,
      );
    },
  };
}
let lastEnv: DemoEnv | undefined;
let worker: ReturnType<typeof createPlaygroundWorker>;
function app(env: DemoEnv) {
  if (env !== lastEnv) {
    worker = createPlaygroundWorker(env);
    lastEnv = env;
  }
  return worker;
}
export default {
  fetch: (request: Request, env: DemoEnv) => app(env).fetch(request),
  scheduled: (_event: unknown, env: DemoEnv) => app(env).scheduled(),
};
