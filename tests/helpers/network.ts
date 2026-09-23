import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { createPostgresNetworkStorage } from "../../packages/network/src/postgres.js";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { createNetworkStorage } from "../../packages/network/src/storage.js";
import { createD1NetworkStorage } from "../../packages/network/src/d1.js";
import type { NetworkD1Database } from "../../packages/network/src/d1.js";
import type { TrainingRow } from "../../packages/network/src/schema.js";
export async function networkBackend(kind: "postgres" | "d1") {
  const sql = await readFile(
    new URL(
      "../../packages/network/migrations/0001_network.sql",
      import.meta.url,
    ),
    "utf8",
  );
  if (kind === "postgres") {
    if (process.env.NETWORK_TEST_DATABASE_URL) {
      const connectionString = process.env.NETWORK_TEST_DATABASE_URL;
      const admin = new Pool({ connectionString, max: 1 });
      const schema = "network_test_" + crypto.randomUUID().replaceAll("-", "");
      await admin.query(`CREATE SCHEMA ${schema}`);
      const pool = new Pool({
        connectionString,
        max: 5,
        options: `-c search_path=${schema}`,
        statement_timeout: 3000,
      });
      await pool.query(sql);
      const bind = (s: string) => {
        let n = 0;
        return s.replaceAll("?", () => `$${++n}`);
      };
      return {
        storage: createPostgresNetworkStorage(pool),
        query: async (s: string, args: unknown[] = []) =>
          (await pool.query(bind(s), args)).rows as Record<string, unknown>[],
        close: async () => {
          await pool.end();
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.end();
        },
      };
    }
    const db = new PGlite();
    await db.exec(sql);
    const bind = (s: string) => {
      let n = 0;
      return s.replaceAll("?", () => `$${++n}`);
    };
    return {
      storage: createNetworkStorage({
        query: async (s, args) =>
          (await db.query<Record<string, unknown>>(bind(s), args)).rows,
        atomic: async (statements) => {
          await db.transaction(async (tx) => {
            for (const s of statements) await tx.query(bind(s.sql), s.args);
          });
        },
      }),
      query: async (sql: string, args: unknown[] = []) =>
        (await db.query(bind(sql), args)).rows,
      close: () => db.close(),
    };
  }
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: ["NETWORK"],
  });
  const db = await mf.getD1Database("NETWORK");
  for (const statement of sql.split(";").filter((s) => s.trim()))
    await db.prepare(statement).run();
  return {
    storage: createD1NetworkStorage(db as unknown as NetworkD1Database),
    query: async (sql: string, args: unknown[] = []) =>
      (
        await db
          .prepare(sql)
          .bind(...args)
          .all()
      ).results,
    close: () => mf.dispose(),
  };
}
export function discoveryFixture(now = Date.now()) {
  const trainingBefore = now - 86_400_000,
    validationBefore = now - 21_600_000;
  const rows: TrainingRow[] = [];
  for (let tenant = 0; tenant < 6; tenant++)
    for (let i = 0; i < 400; i++) {
      const positive = i % 2 === 0,
        stage = tenant >= 3 ? 2 : i < 200 ? 0 : 1;
      const observedAt = [
        trainingBefore - 3_600_000,
        trainingBefore + 3_600_000,
        validationBefore + 3_600_000,
      ][stage]!;
      const index = tenant * 1000 + i + 1;
      rows.push({
        version: 1,
        tenantId: `tenant-${tenant}`,
        sampleId: "sample_" + index.toString(16).padStart(32, "0"),
        sessionReference: "ref_" + index.toString(16).padStart(64, "0"),
        observedAt,
        features: {
          route_telemetry_share: positive || i % 4 === 1 ? 0.5 : 0.05,
          api_gap_cv: positive || i % 4 === 3 ? 0.1 : 2,
          api_request_count: 20,
        },
        cohort: "api",
        trainingAllowed: true,
        target: "assistant",
        positive,
        confirmedAt: observedAt + 1000,
        expiresAt: now + 86_400_000,
      });
    }
  return {
    rows,
    options: {
      target: "assistant" as const,
      trainingBefore,
      validationBefore,
      holdoutTenants: ["tenant-3", "tenant-4", "tenant-5"],
      datasetRevision: 0,
      now,
    },
  };
}
