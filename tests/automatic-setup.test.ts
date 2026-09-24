import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import { createDoorman as node } from "@aarondovturkel/doorman-adapters/node";
import {
  createDoorman as cloudflare,
  createCloudflareVisitor,
} from "@aarondovturkel/doorman-adapters/cloudflare";
import { createDoorman as vercel } from "@aarondovturkel/doorman-adapters/vercel";
import { managedPostgresDatabase } from "@aarondovturkel/doorman-storage-postgres";
import type { D1Database } from "@aarondovturkel/doorman-storage-d1";

const options = {
  secret: "test-only-automatic-schema-secret-123456",
  namespace: "setup-test",
};
const request = (cookie?: string) =>
  new Request("https://example.com/api/visitor", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      signals: { platform: "MacIntel", timezone: "UTC" },
    }),
  });
for (const backend of ["postgres", "d1"] as const) {
  describe(`${backend} automatic schema setup`, () => {
    const pg = backend === "postgres" ? new PGlite() : undefined;
    const mf =
      backend === "d1"
        ? new Miniflare({
            modules: true,
            script: 'export default {fetch() {return new Response("ok")}}',
            d1Databases: ["VISITORS"],
          })
        : undefined;
    afterAll(async () => {
      await pg?.close();
      await mf?.dispose();
    });
    it("creates an empty database, handles concurrent first visits and preserves returning/authenticated context", async () => {
      const db =
        pg ?? ((await mf!.getD1Database("VISITORS")) as unknown as D1Database);
      const first = pg
        ? node({ ...options, db: pg })
        : cloudflare({ ...options, db });
      const second = pg
        ? vercel({ ...options, db: pg })
        : cloudflare({ ...options, db });
      const results = await Promise.all([
        first.assess(request(), { auth: { userId: "alex" } }),
        second.assess(request()),
      ]);
      for (const result of results) expect(result.response.status).toBe(200);
      expect(results[0]!.context?.status).toBe("authenticated");
      const cookie = results[0]!.response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; ");
      const returning = await second.assess(request(cookie));
      expect(returning.identity?.visitorId).toBe(
        results[0]!.identity?.visitorId,
      );
      expect(returning.context?.status).toBe("remembered");
      expect(Object.keys(await returning.response.json()).sort()).toEqual([
        "isReturning",
        "sessionId",
        "visitorId",
      ]);
      // Rechecking from another instance must not clear the tables or stored associations.
      await first.ready();
      await first.cleanup();
      await first.forgetUser!("alex");
      expect((await second.assess(request(cookie))).context?.status).toBe(
        "unknown",
      );
    }, 30_000);
    it("can explicitly leave schema ownership to the application", async () => {
      const db =
        pg ?? ((await mf!.getD1Database("VISITORS")) as unknown as D1Database);
      const handler = pg
        ? node({ ...options, db: pg, autoMigrate: false })
        : cloudflare({ ...options, db, autoMigrate: false });
      await handler.ready();
      expect((await handler.handle(request())).status).toBe(200);
    });
  });
}

it("returns controlled storage errors and retries failed setup after backoff", async () => {
  const pg = new PGlite();
  let unavailable = true;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (unavailable)
      throw new Error("private database credentials must not escape");
    return pg.query<Record<string, unknown>>(sql, values);
  });
  const handler = node({ ...options, db: { query } });
  const failed = await handler.handle(request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("credentials");
  const calls = query.mock.calls.length;
  unavailable = false;
  expect((await handler.handle(request())).status).toBe(503);
  expect(query.mock.calls.length).toBe(calls);
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6000);
  try {
    expect((await handler.handle(request())).status).toBe(200);
  } finally {
    now.mockRestore();
    await pg.close();
  }
});

it("does no schema work after successful initialization on the same connection wrapper", async () => {
  const pg = new PGlite();
  const query = vi.fn((sql: string, values?: unknown[]) =>
    pg.query<Record<string, unknown>>(sql, values),
  );
  const managed = managedPostgresDatabase({ query });
  await managed.ready();
  query.mockClear();
  await managed.db.query("SELECT 1");
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]![0]).toBe("SELECT 1");
  await pg.close();
});

it("recognizes newer D1 bindings that also expose query()", async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch() {return new Response("ok")}}',
    d1Databases: ["VISITORS"],
  });
  try {
    const binding = (await mf.getD1Database(
      "VISITORS",
    )) as unknown as D1Database;
    const query = vi.fn(() => {
      throw new Error("D1 query requires a compatibility flag");
    });
    const db = {
      prepare: binding.prepare.bind(binding),
      batch: binding.batch.bind(binding),
      query,
    };
    const handler = cloudflare({ ...options, db });
    expect((await handler.handle(request())).status).toBe(200);
    expect(
      (await createCloudflareVisitor({ db }).handle(request())).status,
    ).toBe(200);
    expect(query).not.toHaveBeenCalled();
  } finally {
    await mf.dispose();
  }
});
