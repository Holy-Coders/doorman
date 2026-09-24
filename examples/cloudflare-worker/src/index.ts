import type { Ai, D1Database, Fetcher } from "@cloudflare/workers-types";
import { createDoorman } from "@aarondovturkel/doorman-adapters/cloudflare";
interface Env {
  VISITORS: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  JEV_ENABLED: string;
  DOORMAN_IDENTITY_SECRET?: string;
}
// Reuse within an isolate so its in-flight admission limit covers concurrent requests.
let visitor: ReturnType<typeof createDoorman> | undefined;
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/visitor") {
      const secret = env.DOORMAN_IDENTITY_SECRET;
      if (!secret)
        return Response.json(
          { error: "Configure DOORMAN_IDENTITY_SECRET" },
          { status: 503 },
        );
      visitor ??= createDoorman({
        secret,
        namespace: "cloudflare-example",
        crossDevice: true,
        db: env.VISITORS,
        ai: env.JEV_ENABLED === "true" ? env.AI : undefined,
      });
      return visitor.handle(request);
    }
    return env.ASSETS.fetch(request);
  },
};
