import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import {
  createPostgresStorage,
  createPostgresProtectionStorage,
  createPostgresEvidenceStorage,
  createPostgresIdentityStorage,
  createPostgresActivityStorage,
} from "@janitor/storage-postgres";
import {
  createD1Storage,
  createD1ProtectionStorage,
  createD1EvidenceStorage,
  createD1IdentityStorage,
  createD1ActivityStorage,
} from "@janitor/storage-d1";
import type { D1Database } from "@janitor/storage-d1";

export async function sqlBackend(kind: "postgres" | "d1") {
  const dir = new URL(
    `../../packages/storage/${kind}/migrations/`,
    import.meta.url,
  );
  const sql = (
    await Promise.all(
      (await readdir(dir))
        .filter((p) => p.endsWith(".sql"))
        .sort()
        .map((p) => readFile(new URL(p, dir), "utf8")),
    )
  ).join("\n");
  if (kind === "postgres") {
    const db = new PGlite();
    await db.exec(sql);
    return {
      db,
      kind,
      storage: createPostgresStorage(db),
      protection: createPostgresProtectionStorage(db),
      evidence: createPostgresEvidenceStorage(db),
      identities: createPostgresIdentityStorage(db),
      activity: createPostgresActivityStorage(db),
      query: async (s: string, args: unknown[] = []) =>
        (await db.query(s, args)).rows,
      close: () => db.close(),
    };
  }
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ["VISITORS"],
  });
  const binding = await mf.getD1Database("VISITORS");
  for (const statement of sql.split(";").filter((s) => s.trim()))
    await binding.prepare(statement).run();
  const db = binding as unknown as D1Database;
  return {
    db,
    kind,
    storage: createD1Storage(db),
    protection: createD1ProtectionStorage(db),
    evidence: createD1EvidenceStorage(db),
    identities: createD1IdentityStorage(db),
    activity: createD1ActivityStorage(db),
    query: async (s: string, args: unknown[] = []) =>
      (
        await binding
          .prepare(s.replace(/\$\d+/g, "?"))
          .bind(...args)
          .all()
      ).results,
    close: () => mf.dispose(),
  };
}
