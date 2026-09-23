import { createLearning } from "./learning.js";
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
  LearningOptions,
  IdentityStorage,
  VerifiedIdentityContext,
  EngineOptions,
  ManagedVisitorStorage,
  CleanupOptions,
  RetentionOptions,
  VisitorEvaluator,
  VisitorIdentity,
} from "@janitor/core";
import { readPayload, RequestError } from "./validation.js";
export type AdapterOptions = RetentionOptions &
  Omit<EngineOptions, "storage" | "evaluator"> & {
    /** Opt-in public feedback. Prefer assess() for server-only scores. */
    exposeClientScores?: boolean;
    environment?: "production" | "development" | "test";
    cookie?: { name?: string; maxAgeDays?: number; secure?: boolean };
    maxBodyBytes?: number;
    requestTimeoutMs?: number;
    endpointPath?: string;
    subjectLinking?: SubjectLinkingOptions;
    identity?: SubjectLinkingOptions;
    learning?: false | LearningOptions;
  };
export type VisitorRequestContext = {
  authenticatedSubject?: string;
  verified?: VerifiedIdentityContext;
  learningConsent?: boolean;
};
export type VisitorAssessment = {
  response: Response;
  identity?: VisitorIdentity;
};
export function createVisitorHandler(
  storage: ManagedVisitorStorage,
  evaluator: VisitorEvaluator | undefined,
  options: AdapterOptions = {},
  identityStorage?: IdentityStorage,
  learningStorage?: LearningStorage,
) {
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
  const learner =
    options.learning && options.identity && learningStorage
      ? createLearning(learningStorage, options.identity, options.learning)
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
  const engine = createVisitorEngine({ ...options, storage, evaluator });
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
  async function handle(
    request: Request,
    context: VisitorRequestContext = {},
    capture?: (identity: VisitorIdentity) => void,
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
          ? { maxAge: 0, id: undefined }
          : undefined;
      const secure = options.cookie?.secure === false ? "" : "; Secure";
      const fullIdentity: VisitorIdentity = {
        ...identity,
        ...(subjectId ? { subjectId } : {}),
        ...(attribution ? { attribution } : {}),
      };
      capture?.(fullIdentity);
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
  return {
    handle: (request: Request, context?: VisitorRequestContext) =>
      handle(request, context),
    /** Full evidence stays in server memory. Return only response to the browser. */
    async assess(
      request: Request,
      context?: VisitorRequestContext,
    ): Promise<VisitorAssessment> {
      let identity: VisitorIdentity | undefined;
      const response = await handle(request, context, (result) => {
        identity = result;
      });
      return { response, ...(response.ok && identity ? { identity } : {}) };
    },
    identities,
    learning: learner
      ? { reports: learner.reports, deleteSession: learner.deleteSession }
      : undefined,
    async cleanup(options?: CleanupOptions) {
      const progress = await storage.cleanup(options);
      await identities?.cleanup();
      await learner?.cleanup();
      return progress;
    },
    // Server-side only. Applications must authorize erasure and avoid automatic re-identification afterward.
    deleteVisitor: (visitorId: string) => storage.deleteVisitor(visitorId),
  };
}
