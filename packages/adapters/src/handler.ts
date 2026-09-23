import { createVisitorEngine, isVisitorId } from "@janitor/core";
import type {
  EngineOptions,
  ManagedVisitorStorage,
  RetentionOptions,
  VisitorEvaluator,
} from "@janitor/core";
import { readPayload, RequestError } from "./validation.js";
export type AdapterOptions = RetentionOptions &
  Omit<EngineOptions, "storage" | "evaluator"> & {
    environment?: "production" | "development" | "test";
    cookie?: { name?: string; maxAgeDays?: number; secure?: boolean };
    maxBodyBytes?: number;
    endpointPath?: string;
  };
export function createVisitorHandler(
  storage: ManagedVisitorStorage,
  evaluator: VisitorEvaluator | undefined,
  options: AdapterOptions = {},
) {
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
  const engine = createVisitorEngine({ ...options, storage, evaluator });
  const json = (body: unknown, status: number, headers?: HeadersInit) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Origin",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      },
    });
  return {
    async handle(request: Request): Promise<Response> {
      if (
        new URL(request.url).pathname !==
        (options.endpointPath ?? "/api/visitor")
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
        const payload = await readPayload(request, maxBodyBytes);
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
        const secure = options.cookie?.secure === false ? "" : "; Secure";
        return json(identity, 200, {
          "Set-Cookie": `${cookieName}=${identity.visitorId}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAge)}`,
        });
      } catch (error) {
        if (error instanceof RequestError)
          return json({ error: error.message }, error.status);
        return json({ error: "Visitor storage is unavailable" }, 503);
      }
    },
    cleanup: () => storage.cleanup(),
    // Server-side only. Applications must authorize erasure and avoid automatic re-identification afterward.
    deleteVisitor: (visitorId: string) => storage.deleteVisitor(visitorId),
  };
}
