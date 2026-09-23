import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Miniflare } from "miniflare";
import { createNodeVisitor } from "@janitor/adapters/node";
import { createCloudflareVisitor } from "@janitor/adapters/cloudflare";
import type { D1Database } from "@janitor/storage-d1";
import type { VisitorIdentity } from "@janitor/core";
import { signals } from "./helpers/fixtures.js";

for (const backend of ["postgres", "d1"] as const) {
  describe(`${backend} identity directory and delegation (real SQL)`, () => {
    let visitor: ReturnType<typeof createNodeVisitor>;
    let pg: PGlite;
    let mf: Miniflare;
    let query: (sql: string) => Promise<unknown>;
    beforeAll(async () => {
      const schemas = await Promise.all(
        ["0001_visitors", "0002_identity"].map((name) =>
          readFile(
            new URL(
              `../packages/storage/${backend}/migrations/${name}.sql`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
      const identity = { secret: "a".repeat(64), namespace: "identity-tests" };
      if (backend === "postgres") {
        pg = new PGlite();
        await pg.exec(schemas.join("\n"));
        visitor = createNodeVisitor({ db: pg, evaluator: false, identity });
        query = async (sql) => (await pg.query(sql)).rows;
      } else {
        mf = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          d1Databases: ["VISITORS"],
        });
        const db = await mf.getD1Database("VISITORS");
        for (const statement of schemas
          .join("\n")
          .split(";")
          .filter((s) => s.trim()))
          await db.prepare(statement).run();
        visitor = createCloudflareVisitor({
          db: db as unknown as D1Database,
          identity,
        });
        query = async (sql) => (await db.prepare(sql).all()).results;
      }
    }, 30000);
    afterAll(async () => {
      await pg?.close();
      await mf?.dispose();
    });
    const directory = () => visitor.identities!;
    async function principals(prefix: string) {
      const owner = await directory().updateSubject({
        id: prefix + "-owner",
        kind: "person",
      });
      const agent = await directory().updateSubject({
        id: prefix + "-agent",
        kind: "agent",
      });
      const grant = await directory().createDelegation({
        principalId: owner.id,
        actorId: agent.id,
        audience: "calendar",
        scopes: ["events:read"],
        expiresAt: Date.now() + 60000,
      });
      return {
        owner,
        agent,
        grant,
        context: {
          subjectId: owner.id,
          actorId: agent.id,
          delegationId: grant.id,
          audience: "calendar",
          requiredScopes: ["events:read"],
        },
      };
    }
    it("upserts stable subjects and prevents kind changes", async () => {
      const a = await directory().updateSubject({
        id: "user-1",
        kind: "person",
      });
      const b = await directory().updateSubject({
        id: "user-1",
        kind: "person",
      });
      expect(a.id).toBe(b.id);
      await expect(
        directory().updateSubject({ id: "user-1", kind: "agent" }),
      ).rejects.toThrow("kind");
      expect(
        JSON.stringify(await query("SELECT * FROM identity_subjects")),
      ).not.toContain("user-1");
    });
    it("associates verified email and external keys without storing raw values", async () => {
      const subject = await directory().updateSubject({
        id: "key-user",
        kind: "person",
      });
      const email = {
        type: "email" as const,
        issuer: "app",
        value: "Aaron@EXAMPLE.COM",
      };
      const key = {
        type: "public-key" as const,
        issuer: "app",
        value: "public-key-fingerprint",
      };
      await directory().addVerifiedKey(subject.id, email);
      await directory().addVerifiedKey(subject.id, key);
      expect(
        (
          await directory().findSubject({
            ...email,
            value: "Aaron@example.com",
          })
        )?.id,
      ).toBe(subject.id);
      expect(
        await directory().findSubject({ ...email, issuer: "other-app" }),
      ).toBeUndefined();
      expect((await directory().findSubject(key))?.id).toBe(subject.id);
      const stored = JSON.stringify(await query("SELECT * FROM identity_keys"));
      expect(stored).not.toContain("Aaron");
      expect(stored).not.toContain("public-key-fingerprint");
      await directory().removeKey(subject.id, email);
      expect(await directory().findSubject(email)).toBeUndefined();
      expect((await directory().findSubject(key))?.id).toBe(subject.id);
    });
    it("does not merge accounts when concurrent verified keys collide", async () => {
      const a = await directory().updateSubject({
        id: "collision-a",
        kind: "person",
      });
      const b = await directory().updateSubject({
        id: "collision-b",
        kind: "person",
      });
      const key = {
        type: "external" as const,
        issuer: "auth",
        value: "same-credential",
      };
      const results = await Promise.allSettled([
        directory().addVerifiedKey(a.id, key),
        directory().addVerifiedKey(b.id, key),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const winner = await directory().findSubject(key);
      expect([a.id, b.id]).toContain(winner?.id);
      await directory().removeKey(winner!.id === a.id ? b.id : a.id, key);
      expect((await directory().findSubject(key))?.id).toBe(winner!.id);
    });
    it("reports unknown actors unless server-verified actor context is supplied", async () => {
      const { owner } = await principals("unknown");
      expect((await directory().assess()).actor.kind).toBe("unknown");
      const result = await directory().assess({ subjectId: owner.id });
      expect(result.subject.status).toBe("verified");
      expect(result.actor.kind).toBe("unknown");
    });
    it("validates delegation actor, account, audience, scope and revocation", async () => {
      const { owner, agent, grant, context } = await principals("grant");
      expect((await directory().assess(context)).delegation.status).toBe(
        "valid",
      );
      expect((await directory().assess(context)).actor.kind).toBe("agent");
      for (const [change, reason] of [
        [{ subjectId: agent.id }, "principal"],
        [{ actorId: owner.id }, "actor"],
        [{ actorId: undefined }, "actor"],
        [{ audience: "other-service" }, "audience"],
        [{ audience: undefined }, "audience"],
        [{ requiredScopes: ["events:delete"] }, "scope"],
      ] as const)
        expect(
          (await directory().assess({ ...context, ...change })).delegation,
        ).toMatchObject({ status: "invalid", reason });
      await directory().revokeDelegation(grant.id);
      expect((await directory().assess(context)).delegation).toMatchObject({
        status: "invalid",
        reason: "revoked",
      });
    });
    it("supports separately authenticated family members without guessing from signals", async () => {
      const owner = await directory().updateSubject({
        id: "family-owner",
        kind: "person",
      });
      const member = await directory().updateSubject({
        id: "family-member",
        kind: "person",
      });
      const grant = await directory().createDelegation({
        principalId: owner.id,
        actorId: member.id,
        audience: "family-app",
        scopes: ["album:read"],
        expiresAt: Date.now() + 60000,
      });
      const result = await directory().assess({
        subjectId: owner.id,
        actorId: member.id,
        delegationId: grant.id,
        audience: "family-app",
        requiredScopes: ["album:read"],
      });
      expect(result.actor).toMatchObject({
        id: member.id,
        kind: "person",
        basis: "verified-credential",
      });
      expect(result.delegation.status).toBe("valid");
    });
    it("checks expiry before cleanup and cascades erasure to keys and grants", async () => {
      const { owner, agent, grant, context } = await principals("erasure");
      const key = {
        type: "email" as const,
        issuer: "app",
        value: "delete@example.com",
      };
      await directory().addVerifiedKey(owner.id, key);
      // Exercise storage expiry with a real SQL update, without sleeps.
      const record = { ...grant, expiresAt: Date.now() - 1000 };
      await query(
        `UPDATE identity_delegations SET expires_at = ${record.expiresAt}, record = '${JSON.stringify(record)}' WHERE id = '${grant.id}'`,
      );
      expect((await directory().assess(context)).delegation.reason).toBe(
        "expired",
      );
      await directory().cleanup();
      expect((await directory().assess(context)).delegation.reason).toBe(
        "missing",
      );
      const second = await directory().createDelegation({
        principalId: owner.id,
        actorId: agent.id,
        audience: "calendar",
        scopes: ["events:read"],
        expiresAt: Date.now() + 60000,
      });
      await directory().deleteSubject(owner.id);
      expect(await directory().findSubject(key)).toBeUndefined();
      expect(
        (await directory().assess({ ...context, delegationId: second.id }))
          .delegation.reason,
      ).toBe("missing");
    });
    it("returns attribution through the adapter without making an access decision", async () => {
      const { context, grant } = await principals("endpoint");
      const request = (extra = {}) =>
        new Request("https://app.test/api/visitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signals, ...extra }),
        });
      const response = await visitor.handle(request(), { verified: context });
      expect(response.status).toBe(200);
      const identity = (await response.json()) as VisitorIdentity;
      expect(identity.attribution?.delegation.status).toBe("valid");
      expect(identity.risk).toEqual({ automation: 0, suspicious: 0 });
      expect(identity.visitorId).toMatch(/^vis_/);
      await directory().revokeDelegation(grant.id);
      const invalid = await visitor.handle(request(), { verified: context });
      expect(invalid.status).toBe(200);
      expect(
        ((await invalid.json()) as VisitorIdentity).attribution?.delegation
          .reason,
      ).toBe("revoked");
      expect(
        (await visitor.handle(request({ verified: context }))).status,
      ).toBe(400);
      const anonymous = await visitor.handle(request());
      expect(
        ((await anonymous.json()) as VisitorIdentity).attribution?.subject
          .status,
      ).toBe("unknown");
    });
    it("rejects invalid management inputs and overlong delegations", async () => {
      const { owner, agent } = await principals("validation");
      await expect(
        directory().addVerifiedKey(owner.id, {
          type: "email",
          issuer: "app",
          value: "invalid",
        }),
      ).rejects.toThrow();
      await expect(
        directory().createDelegation({
          principalId: owner.id,
          actorId: agent.id,
          audience: "app",
          scopes: [],
          expiresAt: Date.now() + 60000,
        }),
      ).rejects.toThrow();
      await expect(
        directory().createDelegation({
          principalId: owner.id,
          actorId: agent.id,
          audience: "app",
          scopes: ["read"],
          expiresAt: Date.now() + 31 * 86400000,
        }),
      ).rejects.toThrow();
    });
  });
}
