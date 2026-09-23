import { createEvidence, requestEvidence } from "./evidence.js";
import type { EvidenceOptions, TrustedRequestEvidence } from "./evidence.js";
import { createLearning } from "./learning.js";
import { createProtection } from "./protection.js";
import type { AdmissionContext, ProtectionOptions } from "./protection.js";
import { createIdentityDirectory } from "./identity.js";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";
import {
  createVisitorEngine,
  isVisitorId,
  normalizeObservation,
} from "@janitor/core";
import type {
  LearningStorage,
  LearningPrediction,
  LearningOptions,
  IdentityStorage,
  VerifiedIdentityContext,
  EngineOptions,
  ManagedVisitorStorage,
  CleanupOptions,
  RetentionOptions,
  VisitorEvaluator,
  VisitorIdentity,
  ProtectionStorage,
  EvidenceStorage,
  RequestEvidence,
} from "@janitor/core";
import { readPayload, RequestError } from "./validation.js";
const EVALUATOR_STORAGE_GRACE_MS = 1000;
export type AdapterOptions = RetentionOptions &
  Omit<EngineOptions, "storage" | "evaluator"> & {
    /** Opt-in public feedback. Prefer assess() for server-only scores. */
    exposeClientScores?: boolean;
    protection?: ProtectionOptions;
    evidence?: true | EvidenceOptions;
    environment?: "production" | "development" | "test";
    cookie?: { name?: string; maxAgeDays?: number; secure?: boolean };
    maxBodyBytes?: number;
    requestTimeoutMs?: number;
    /** Per reusable handler instance. Excess measurement requests get 503 without database work. */
    maxInFlightRequests?: number;
    onOverload?: () => void;
    endpointPath?: string;
    subjectLinking?: SubjectLinkingOptions;
    identity?: SubjectLinkingOptions;
    learning?: false | LearningOptions;
  };
export type VisitorRequestContext = {
  authenticatedSubject?: string;
  verified?: VerifiedIdentityContext;
  learningConsent?: boolean;
  /** Server-owned account/session references; never copy these from browser JSON or headers. */
  admission?: AdmissionContext;
  evidence?: TrustedRequestEvidence;
};
export type VisitorAssessment = {
  response: Response;
  identity?: VisitorIdentity;
  evidence?: RequestEvidence;
  /** Private, unverified suggestion. Never used as authenticated identity. */
  learning?: LearningPrediction;
};
export function createVisitorHandler(
  storage: ManagedVisitorStorage,
  evaluator: VisitorEvaluator | undefined,
  options: AdapterOptions = {},
  identityStorage?: IdentityStorage,
  learningStorage?: LearningStorage,
  protectionStorage?: ProtectionStorage,
  evidenceStorage?: EvidenceStorage,
) {
  const maxInFlight = options.maxInFlightRequests ?? 64;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 1024)
    throw new Error("Request concurrency must be 1–1024");
  let inFlight = 0;
  if (options.evidence && (!options.identity || !evidenceStorage))
    throw new Error(
      "Evidence requires identity configuration and evidence storage",
    );
  const evidence =
    options.evidence && options.identity && evidenceStorage
      ? createEvidence(
          evidenceStorage,
          options.identity,
          options.evidence === true ? {} : options.evidence,
        )
      : undefined;
  if (options.protection && !protectionStorage)
    throw new Error("Protection storage is required");
  const protection =
    options.protection && protectionStorage
      ? createProtection(
          protectionStorage,
          options.protection,
          options.evaluatorTimeoutMs ?? 1200,
        )
      : undefined;
  if (options.identity && !identityStorage)
    throw new Error("Identity storage is required");
  const identities =
    options.identity && identityStorage
      ? createIdentityDirectory(identityStorage, options.identity)
      : undefined;
  if (
    options.learning &&
    (options.learning.enabled !== true || !options.identity || !learningStorage)
  )
    throw new Error(
      "Learning requires explicit enablement, identity configuration and learning storage",
    );
  const guardedEvaluator =
    evaluator && protection ? protection.wrap(evaluator) : evaluator;
  const learner =
    options.learning && options.identity && learningStorage
      ? createLearning(
          learningStorage,
          options.identity,
          options.learning,
          guardedEvaluator,
        )
      : undefined;
  const linkSubject = options.subjectLinking
    ? createSubjectLinker(options.subjectLinking)
    : undefined;
  const environment = options.environment ?? "production";
  if (options.debug && environment === "production")
    throw new Error("Debug requires a non-production environment");
  if (options.cookie?.secure === false && environment === "production")
    throw new Error("Production cookies must be Secure");
  const cookieName = options.cookie?.name ?? "__visitor";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cookieName))
    throw new Error("Invalid cookie name");
  const maxAge =
    (options.cookie?.maxAgeDays ?? options.observationRetentionDays ?? 90) *
    86400;
  if (!Number.isFinite(maxAge) || maxAge <= 0 || maxAge > 34_560_000)
    throw new Error("Cookie lifetime must be between 0 and 400 days");
  const maxBodyBytes = options.maxBodyBytes ?? 16_384;
  if (
    !Number.isInteger(maxBodyBytes) ||
    maxBodyBytes < 1 ||
    maxBodyBytes > 65_536
  )
    throw new Error("Invalid body size limit");
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  if (
    !Number.isFinite(requestTimeoutMs) ||
    requestTimeoutMs < 100 ||
    requestTimeoutMs > 30000
  )
    throw new Error("Request timeout must be 100–30000ms");
  const engine = createVisitorEngine({
    ...options,
    // Allow the guard's provider deadline to fire and persist its circuit outcome.
    // The engine still caps a stalled guard; database/driver deadlines remain app-owned.
    evaluatorTimeoutMs: protection
      ? (options.evaluatorTimeoutMs ?? 1200) + EVALUATOR_STORAGE_GRACE_MS
      : options.evaluatorTimeoutMs,
    storage,
    evaluator: guardedEvaluator,
  });
  const json = (body: unknown, status: number, headers?: HeadersInit) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Origin, Authorization",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      },
    });
  async function processRequest(
    request: Request,
    context: VisitorRequestContext = {},
    capture?: (
      identity: VisitorIdentity,
      evidence: RequestEvidence,
      learning?: LearningPrediction,
    ) => void,
  ): Promise<Response> {
    if (
      new URL(request.url).pathname !== (options.endpointPath ?? "/api/visitor")
    )
      return json({ error: "Not found" }, 404);
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== url.origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return json({ error: "Cross-origin requests are not allowed" }, 403);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return json({ error: "Content-Type must be application/json" }, 415);
    if (
      options.cookie?.secure === false &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return json({ error: "Insecure cookies require localhost" }, 400);
    try {
      const trustedEvidence = requestEvidence(context.evidence);
      const admission = await protection?.admit(context.admission);
      if (admission && !admission.allowed)
        return json({ error: "Visitor measurement rate limited" }, 429, {
          "Retry-After": String(admission.retryAfterSeconds),
        });
      const payload = await readPayload(
        request,
        maxBodyBytes,
        requestTimeoutMs,
      );
      if (context.verified && !identities)
        throw new RequestError(500, "Identity directory is not configured");
      if (context.verified && context.authenticatedSubject)
        throw new RequestError(400, "Use one identity context");
      const attribution = identities
        ? await identities.assess(context.verified)
        : undefined;
      const subject = context.authenticatedSubject;
      if (
        subject !== undefined &&
        (typeof subject !== "string" || !subject.trim() || subject.length > 512)
      )
        throw new RequestError(400, "Invalid authenticated subject");
      if (subject !== undefined && !linkSubject)
        throw new RequestError(500, "Subject linking is not configured");
      const subjectId =
        subject !== undefined ? await linkSubject!(subject) : undefined;
      const cookies = (request.headers.get("cookie") ?? "")
        .split(";")
        .map((cookie) => cookie.trim())
        .filter((cookie) => cookie.startsWith(`${cookieName}=`));
      const id =
        cookies.length === 1
          ? cookies[0]?.slice(cookieName.length + 1)
          : undefined;
      const identity = await engine.identify({
        ...payload,
        visitorId: id && isVisitorId(id) ? id : undefined,
      });
      const learningCookies = (request.headers.get("cookie") ?? "")
        .split(";")
        .map((cookie) => cookie.trim())
        .filter((cookie) => cookie.startsWith(`${cookieName}_learning=`));
      const learningSessionId =
        learningCookies.length === 1
          ? learningCookies[0]?.slice(cookieName.length + 10)
          : undefined;
      const learningCookie = learner
        ? await learner.observe({
            sessionId: learningSessionId,
            allowed:
              context.learningConsent === true ||
              (context.learningConsent !== false &&
                options.learning !== false &&
                options.learning?.collectionPolicy === "application"),
            authenticated:
              context.verified !== undefined ||
              context.authenticatedSubject !== undefined,
            attribution,
            observation: normalizeObservation(
              payload.signals,
              payload.behavior,
            ),
          })
        : learningCookies.length
          ? { maxAge: 0, id: undefined, prediction: undefined }
          : undefined;
      const secure = options.cookie?.secure === false ? "" : "; Secure";
      const fullIdentity: VisitorIdentity = {
        ...identity,
        ...(subjectId ? { subjectId } : {}),
        ...(attribution ? { attribution } : {}),
      };
      capture?.(fullIdentity, trustedEvidence, learningCookie?.prediction);
      const response = json(
        options.exposeClientScores === true
          ? fullIdentity
          : {
              visitorId: identity.visitorId,
              isReturning: identity.isReturning,
            },
        200,
        {
          "Set-Cookie": `${cookieName}=${identity.visitorId}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAge)}`,
        },
      );
      if (learningCookie && (learningCookie.id || learningCookies.length))
        response.headers.append(
          "Set-Cookie",
          `${cookieName}_learning=${learningCookie.id ?? ""}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${learningCookie.maxAge}`,
        );
      return response;
    } catch (error) {
      if (error instanceof RequestError)
        return json({ error: error.message }, error.status);
      return json({ error: "Visitor storage is unavailable" }, 503);
    }
  }
  async function handle(
    request: Request,
    context?: VisitorRequestContext,
    capture?: (
      identity: VisitorIdentity,
      evidence: RequestEvidence,
      learning?: LearningPrediction,
    ) => void,
  ): Promise<Response> {
    if (inFlight >= maxInFlight) {
      try {
        options.onOverload?.();
      } catch {
        /* Metrics cannot change admission. */
      }
      return json({ error: "Visitor measurement is busy" }, 503, {
        "Retry-After": "1",
      });
    }
    inFlight++;
    try {
      return await processRequest(request, context, capture);
    } finally {
      inFlight--;
    }
  }
  return {
    handle: (request: Request, context?: VisitorRequestContext) =>
      handle(request, context),
    /** Full evidence stays in server memory. Return only response to the browser. */
    async assess(
      request: Request,
      context?: VisitorRequestContext,
    ): Promise<VisitorAssessment> {
      let identity: VisitorIdentity | undefined;
      let evidence: RequestEvidence | undefined;
      let learning: LearningPrediction | undefined;
      const response = await handle(
        request,
        context,
        (result, trusted, prediction) => {
          learning = prediction;
          identity = result;
          evidence = trusted;
        },
      );
      return {
        response,
        ...(response.ok && identity
          ? { identity, evidence, ...(learning ? { learning } : {}) }
          : {}),
      };
    },
    identities,
    evidence,
    learning: learner
      ? { reports: learner.reports, deleteSession: learner.deleteSession }
      : undefined,
    async cleanup(options?: CleanupOptions) {
      const progress = await storage.cleanup(options);
      await identities?.cleanup();
      await learner?.cleanup();
      await protection?.cleanup();
      await evidence?.cleanup();
      return progress;
    },
    // Server-side only. Applications must authorize erasure and avoid automatic re-identification afterward.
    deleteVisitor: (visitorId: string) => storage.deleteVisitor(visitorId),
  };
}
