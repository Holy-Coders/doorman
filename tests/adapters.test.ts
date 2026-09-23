import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import {
  createNodeVisitor,
  createVisitorHandler,
} from "@janitor/adapters/node";
import { createVercelVisitor } from "@janitor/adapters/vercel";
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";
import type { D1Database } from "@janitor/storage-d1";
import type { VisitorIdentity } from "@janitor/core";
import { createMemoryStorage } from "./helpers/memory.js";
import { evaluation, signals } from "./helpers/fixtures.js";
function request(
  body: unknown = { signals },
  headers: Record<string, string> = {},
) {
  return new Request("https://example.com/api/visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
for (const backend of ["node", "vercel", "cloudflare"] as const) {
  describe(`${backend} high-level adapter`, () => {
    let handler: ReturnType<typeof createNodeVisitor>;
    let postgres: PGlite;
    let miniflare: Miniflare;
    beforeAll(async () => {
      const storageType = backend === "cloudflare" ? "d1" : "postgres";
      const schema = await readFile(
        new URL(
          `../packages/storage/${storageType}/migrations/0001_visitors.sql`,
          import.meta.url,
        ),
        "utf8",
      );
      if (backend === "cloudflare") {
        miniflare = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          d1Databases: ["VISITORS"],
        });
        const db = await miniflare.getD1Database("VISITORS");
        for (const sql of schema.split(";").filter((sql) => sql.trim()))
          await db.prepare(sql).run();
        handler = createCloudflareVisitor({
          db: db as unknown as D1Database,
          ai: {
            run: async () => ({
              answers: Object.fromEntries(
                Object.entries(evaluation).map(([name, noul]) => [
                  name,
                  { type: "noul", noul },
                ]),
              ),
            }),
          },
        });
      } else {
        postgres = new PGlite();
        await postgres.exec(schema);
        handler = (
          backend === "node" ? createNodeVisitor : createVercelVisitor
        )({ db: postgres, evaluator: { evaluate: async () => evaluation } });
      }
    }, 30_000);
    afterAll(async () => {
      await postgres?.close();
      await miniflare?.dispose();
    });
    it("sets a secure cookie and restores the ID on cookie and cookieless requests", async () => {
      const first = await handler.handle(request());
      expect(first.status).toBe(200);
      const cookie = first.headers.get("set-cookie")!;
      for (const flag of [
        "__visitor=vis_",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
      ])
        expect(cookie).toContain(flag);
      const id = ((await first.json()) as VisitorIdentity).visitorId;
      const second = await handler.handle(
        request({ signals }, { Cookie: cookie.split(";")[0]! }),
      );
      expect(await second.json()).toMatchObject({
        visitorId: id,
        isReturning: true,
        confidence: 1,
      });
      const restored = await handler.handle(request());
      expect(await restored.json()).toMatchObject({
        visitorId: id,
        isReturning: true,
      });
      await handler.deleteVisitor(id);
      await handler.cleanup();
    });
  });
}
describe("HTTP boundary", () => {
  it.each([
    [{ signals: { userAgent: "x".repeat(513) } }, 400],
    [{ signals: { languages: Array(21).fill("en") } }, 400],
    [{ signals: { screen: { width: -1 } } }, 400],
    [{ signals: { formValues: "never retain me" } }, 400],
    [{ signals: { automation: { webdriver: "false" } } }, 400],
    [{ signals: null }, 400],
    [{ signals: {}, behavior: { actualKey: "secret" } }, 400],
    [{ signals: { userAgent: "x".repeat(20_000) } }, 413],
  ])("rejects invalid or oversized payloads", async (body, status) => {
    expect(
      (
        await createVisitorHandler(createMemoryStorage(), undefined).handle(
          request(body),
        )
      ).status,
    ).toBe(status);
  });
  it("enforces size limits on streamed bodies without Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(17_000));
        controller.close();
      },
    });
    const req = new Request("https://example.com/api/visitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(
      (await createVisitorHandler(createMemoryStorage(), undefined).handle(req))
        .status,
    ).toBe(413);
  });
  it("rejects bad methods, cross-origin requests, invalid JSON and incorrect content types", async () => {
    const handler = createVisitorHandler(createMemoryStorage(), undefined);
    expect(
      (await handler.handle(new Request("https://example.com/api/visitor")))
        .status,
    ).toBe(405);
    expect(
      (
        await handler.handle(
          request({ signals }, { origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler.handle(
          request({ signals }, { "content-type": "text/plain" }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await handler.handle(
          new Request("https://example.com/api/visitor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{bad",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("only exposes debug with explicit non-production server and browser opt-in", async () => {
    expect(() =>
      createVisitorHandler(createMemoryStorage(), undefined, { debug: true }),
    ).toThrow("non-production");
    const handler = createVisitorHandler(createMemoryStorage(), undefined, {
      debug: true,
      environment: "test",
    });
    expect(
      (await (await handler.handle(request({ signals }))).json()).debug,
    ).toBeUndefined();
    expect(
      (await (await handler.handle(request({ signals, debug: true }))).json())
        .debug,
    ).toBeDefined();
  });
  it("returns a sanitized no-store 503 for storage failure without setting a cookie", async () => {
    const storage = createMemoryStorage();
    vi.spyOn(storage, "findCandidates").mockRejectedValue(
      new Error("SECRET DATABASE CREDENTIAL"),
    );
    const response = await createVisitorHandler(storage, undefined).handle(
      request(),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects unsafe production configuration and keeps logging free of fingerprint payloads", async () => {
    const storage = createMemoryStorage();
    expect(() =>
      createVisitorHandler(storage, undefined, {
        cookie: { name: "bad;name" },
      }),
    ).toThrow();
    expect(() =>
      createVisitorHandler(storage, undefined, { cookie: { secure: false } }),
    ).toThrow();
    const onMetrics = vi.fn();
    await createVisitorHandler(storage, undefined, { onMetrics }).handle(
      request(),
    );
    expect(Object.keys(onMetrics.mock.calls[0]?.[0])).toEqual([
      "candidateCount",
      "deterministicScore",
      "finalConfidence",
      "evaluatorUsed",
      "evaluatorLatency",
      "isReturning",
    ]);
  });
});
