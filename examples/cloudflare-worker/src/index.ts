import type { Ai, D1Database, Fetcher } from "@cloudflare/workers-types";
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";
interface Env {
  VISITORS: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  JEV_ENABLED: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/visitor") {
      const visitor = createCloudflareVisitor({
        db: env.VISITORS,
        ai: env.JEV_ENABLED === "true" ? env.AI : undefined,
      });
      return visitor.handle(request);
    }
    return env.ASSETS.fetch(request);
  },
};
