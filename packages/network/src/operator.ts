import { z } from "zod";
import { digest, readJSON } from "./http.js";
import { opaqueId } from "./schema.js";
import type { createLearningService } from "./server.js";
/** Mount separately with an operator credential; tenant keys never grant this access. */
export function createLearningOperator(
  service: ReturnType<typeof createLearningService>,
  keyHash: string,
) {
  if (!/^[a-f0-9]{64}$/.test(keyHash))
    throw new Error("Expected operator SHA-256 digest");
  const json = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST" || request.headers.has("origin"))
      return json({ error: "Forbidden" }, 403);
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
    if (!token || (await digest(token)) !== keyHash)
      return json({ error: "Unauthorized" }, 401);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return json({ error: "JSON required" }, 415);
    try {
      const body = await readJSON(request.body, 4096);
      switch (new URL(request.url).pathname) {
        case "/operator/tenants":
          return json(
            await service.registerTenant(
              z
                .strictObject({
                  trainingApproved: z.boolean().default(false),
                  retentionDays: z.number().int().min(1).max(30).default(30),
                })
                .parse(body),
            ),
            201,
          );
        case "/operator/discover":
          return json(
            await service.discover(
              z
                .strictObject({
                  target: z.enum(["assistant", "abuse"]),
                  trainingBefore: z.number().int().positive(),
                  validationBefore: z.number().int().positive(),
                  holdoutTenants: z.array(opaqueId).min(3).max(10),
                })
                .parse(body),
            ),
          );
        case "/operator/promote": {
          const value = z
            .strictObject({
              modelId: opaqueId,
              canaryPercent: z.number().int().min(1).max(100).default(1),
            })
            .parse(body);
          await service.promote(value.modelId, value.canaryPercent);
          return json({ status: "canary" });
        }
        case "/operator/rollback": {
          const value = z.strictObject({ modelId: opaqueId }).parse(body);
          await service.rollback(value.modelId);
          return json({ status: "retired" });
        }
        case "/operator/cleanup":
          z.strictObject({}).parse(body);
          await service.cleanup();
          return json({ status: "cleaned" });
        case "/operator/revoke": {
          const value = z.strictObject({ tenantId: opaqueId }).parse(body);
          await service.revokeTenant(value.tenantId);
          return json({ status: "revoked" });
        }
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch {
      return json(
        {
          error:
            "Operation rejected; check input, data eligibility and model gates",
        },
        400,
      );
    }
  };
}
