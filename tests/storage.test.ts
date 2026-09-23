import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import { createD1Storage } from "@janitor/storage-d1";
import type { D1Database } from "@janitor/storage-d1";
import { createPostgresStorage } from "@janitor/storage-postgres";
import {
  DAY_MS,
  normalizeObservation,
  createVisitorEngine,
} from "@janitor/core";
import type { ManagedVisitorStorage } from "@janitor/core";
import { signals } from "./helpers/fixtures.js";

for (const backend of ["postgres", "d1"] as const) {
  describe(`${backend} shared storage contract (real SQL)`, () => {
    let storage: ManagedVisitorStorage;
    let postgres: PGlite;
    let miniflare: Miniflare;
    let execute: (sql: string) => Promise<unknown>;
    let count: () => Promise<number>;
    beforeAll(async () => {
      let schema = await readFile(
        new URL(
          `../packages/storage/${backend}/migrations/0001_visitors.sql`,
          import.meta.url,
        ),
        "utf8",
      );
      schema += await readFile(
        new URL(
          `../packages/storage/${backend}/migrations/0004_candidate_lookup.sql`,
          import.meta.url,
        ),
        "utf8",
      );
      if (backend === "postgres") {
        postgres = new PGlite();
        await postgres.exec(schema);
        storage = createPostgresStorage(postgres, {
          maxObservationsPerVisitor: 3,
        });
        execute = (sql) => postgres.exec(sql);
        count = async () =>
          Number(
            (
              await postgres.query<{ count: string }>(
                "SELECT count(*) FROM observations",
              )
            ).rows[0]?.count,
          );
      } else {
        miniflare = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          d1Databases: ["VISITORS"],
        });
        const db = await miniflare.getD1Database("VISITORS");
        for (const statement of schema.split(";").filter((part) => part.trim()))
          await db.prepare(statement).run();
        storage = createD1Storage(db as unknown as D1Database, {
          maxObservationsPerVisitor: 3,
        });
        execute = (sql) => db.prepare(sql).run();
        count = async () =>
          Number(
            (
              await db
                .prepare("SELECT count(*) AS count FROM observations")
                .first<{ count: number }>()
            )?.count,
          );
      }
    }, 30_000);
    afterAll(async () => {
      await postgres?.close();
      await miniflare?.dispose();
    });
    it("creates, persists, reads, touches and deletes with cascading history", async () => {
      const id = await storage.createVisitor();
      await storage.saveObservation(id, normalizeObservation(signals));
      await storage.touchVisitor(id);
      expect(await storage.getRecentObservations(id, 5)).toEqual([
        normalizeObservation(signals),
      ]);
      expect(
        (await storage.findCandidates(normalizeObservation(signals), 10)).some(
          (row) => row.visitorId === id,
        ),
      ).toBe(true);
      await storage.deleteVisitor(id);
      expect(await storage.getRecentObservations(id, 5)).toEqual([]);
      expect(await count()).toBe(0);
    });
    it("prunes to the configured maximum, orders ties by insertion, and supports concurrent writes", async () => {
      const id = await storage.createVisitor();
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          storage.saveObservation(
            id,
            normalizeObservation({ ...signals, timezone: `zone-${i}` }),
          ),
        ),
      );
      expect(await storage.getRecentObservations(id, 100)).toHaveLength(3);
      expect(await count()).toBe(3);
      await storage.deleteVisitor(id);
    });
    it("returns at most ten unique recent candidates and avoids empty-signal scans", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 14; i++) {
        const id = await storage.createVisitor();
        ids.push(id);
        await storage.saveObservation(id, normalizeObservation(signals));
        await execute(
          `UPDATE observations SET seen_at = ${Date.now() - (14 - i) * 1000} WHERE visitor_id = '${id}'`,
        );
      }
      const candidates = await storage.findCandidates(
        normalizeObservation(signals),
        100,
      );
      expect(candidates).toHaveLength(10);
      expect(new Set(candidates.map((row) => row.visitorId)).size).toBe(10);
      expect(candidates[0]?.visitorId).toBe(ids[13]);
      expect(await storage.findCandidates({}, 10)).toEqual([]);
      for (const id of ids) await storage.deleteVisitor(id);
    });
    it("ignores expired history before cleanup and deletes expired visitors afterward", async () => {
      const id = await storage.createVisitor();
      await storage.saveObservation(id, normalizeObservation(signals));
      const expired = Date.now() - 91 * DAY_MS;
      await execute(`UPDATE observations SET seen_at = ${expired}`);
      await execute(`UPDATE visitors SET last_seen_at = ${expired}`);
      expect(await storage.getRecentObservations(id, 5)).toEqual([]);
      expect(
        await storage.findCandidates(normalizeObservation(signals), 10),
      ).toEqual([]);
      await storage.cleanup();
      expect(await count()).toBe(0);
    });
    it("retrieves an older strong match from a crowded browser bucket across ordinary drift", async () => {
      const target = await storage.createVisitor();
      await storage.saveObservation(target, normalizeObservation(signals));
      await execute(
        `UPDATE observations SET seen_at = ${Date.now() - 86_400_000} WHERE visitor_id = '${target}'`,
      );
      const decoys: string[] = [];
      for (let i = 0; i < 110; i++) {
        const id = await storage.createVisitor();
        decoys.push(id);
        await storage.saveObservation(
          id,
          normalizeObservation({
            ...signals,
            screen: { width: 1920, height: 1080 },
            hardware: {
              hardwareConcurrency: 4,
              deviceMemory: 4,
              maxTouchPoints: 0,
            },
            languages: ["fr"],
          }),
        );
      }
      for (const changed of [
        signals,
        { ...signals, timezone: "Europe/London" },
        { ...signals, graphics: undefined },
        {
          ...signals,
          screen: { width: 900, height: 1440 },
          viewport: { width: 400, height: 700 },
        },
      ]) {
        const candidates = await storage.findCandidates(
          normalizeObservation(changed),
          10,
        );
        expect(candidates[0]).toMatchObject({
          visitorId: target,
          lookupSaturated: false,
        });
      }
      const candidates = await storage.findCandidates(
        normalizeObservation(signals),
        10,
      );
      const histories = await storage.getRecentObservationsBatch!(
        candidates.map((c) => c.visitorId),
        100,
      );
      expect(histories[target]).toEqual(
        await storage.getRecentObservations(target, 5),
      );
      expect(await storage.getRecentObservationsBatch!([], 5)).toEqual({});
      const result = await createVisitorEngine({ storage }).identify({
        signals,
      });
      expect(result).toMatchObject({ visitorId: target, isReturning: true });
      for (const id of [target, ...decoys]) await storage.deleteVisitor(id);
    }, 30_000);
    it("marks fully crowded matching buckets and abstains even with confident AI", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 102; i++) {
        const id = await storage.createVisitor();
        ids.push(id);
        await storage.saveObservation(id, normalizeObservation(signals));
      }
      const candidates = await storage.findCandidates(
        normalizeObservation(signals),
        10,
      );
      expect(candidates).toHaveLength(10);
      expect(candidates.every((c) => c.lookupSaturated)).toBe(true);
      const result = await createVisitorEngine({
        storage,
        evaluator: {
          evaluate: async () => ({
            sameVisitor: 1,
            automation: 0,
            suspicious: 0,
          }),
        },
      }).identify({ signals });
      expect(result.isReturning).toBe(false);
      for (const id of [...ids, result.visitorId])
        await storage.deleteVisitor(id);
    }, 30_000);
    it("paginates cleanup and repairs only the selected visitor histories", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = await storage.createVisitor();
        ids.push(id);
        await storage.saveObservation(id, normalizeObservation(signals));
      }
      // Simulate interrupted pruning without changing production retention settings.
      await execute(
        "INSERT INTO observations (visitor_id,seen_at,signals_json) SELECT visitor_id,seen_at,signals_json FROM observations",
      );
      await execute(
        "INSERT INTO observations (visitor_id,seen_at,signals_json) SELECT visitor_id,seen_at,signals_json FROM observations",
      );
      expect(await count()).toBe(16);
      let page = await storage.cleanup({ batchSize: 1 });
      expect(page?.nextVisitorId).toBeDefined();
      expect(await count()).toBe(15);
      while (page?.nextVisitorId)
        page = await storage.cleanup({
          batchSize: 1,
          afterVisitorId: page.nextVisitorId,
        });
      expect(await count()).toBe(12);
      const expired = Date.now() - 91 * DAY_MS;
      await execute(`UPDATE observations SET seen_at = ${expired}`);
      await execute(`UPDATE visitors SET last_seen_at = ${expired}`);
      page = await storage.cleanup({ batchSize: 2 });
      expect(page?.hasMoreExpired).toBe(true);
      expect(await count()).toBe(10);
      for (let i = 0; i < 10 && page?.hasMoreExpired; i++)
        page = await storage.cleanup({ batchSize: 2 });
      expect(await count()).toBe(0);
      for (const id of ids) await storage.deleteVisitor(id);
    });
    it("rejects observations for nonexistent visitors", async () => {
      await expect(
        storage.saveObservation("missing", normalizeObservation(signals)),
      ).rejects.toThrow();
    });
  });
}
