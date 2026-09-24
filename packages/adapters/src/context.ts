import { z } from "zod";
import type {
  AuthContext,
  BrowserAssociation,
  ContextStorage,
  IdentityContext,
  LearningPrediction,
  VisitorIdentity,
} from "@aarondovturkel/doorman-core";
import { createSubjectLinker, type SubjectLinkingOptions } from "./subject.js";
import type { createIdentityDirectory } from "./identity.js";

const id = z.string().trim().min(1).max(512);
export const authContextSchema = z.strictObject({
  userId: id,
  accountId: id.optional(),
  actor: z.strictObject({ id, kind: z.enum(["person", "agent"]) }).optional(),
});
export function createContext(
  storage: ContextStorage,
  identity: SubjectLinkingOptions,
  directory: ReturnType<typeof createIdentityDirectory>,
  retentionDays = 90,
) {
  const label = createSubjectLinker(identity);
  const scope = label("doorman-context-v1");
  const blank = (): IdentityContext => ({
    status: "unknown",
    basis: "none",
    candidates: [],
    calibrated: false,
    truncated: false,
  });
  return {
    async authenticate(input?: AuthContext) {
      if (!input) return undefined;
      const auth = authContextSchema.parse(input);
      if (auth.actor?.kind === "agent" && auth.actor.id === auth.userId)
        throw new Error("Agent and principal must use distinct IDs");
      const subject = await directory.updateSubject({
        id: auth.userId,
        kind: "person",
      });
      const actor = auth.actor
        ? await directory.updateSubject({
            id: auth.actor.id,
            kind: auth.actor.kind,
          })
        : subject;
      return {
        subjectId: subject.id,
        actorId: actor.id,
        actorKind: actor.kind,
        ...(auth.accountId
          ? {
              accountId: await label(
                JSON.stringify(["account-v1", auth.accountId]),
              ),
            }
          : {}),
      };
    },
    async resolve(
      identity: VisitorIdentity,
      cookieId: string | undefined,
      auth:
        | {
            subjectId: string;
            actorId: string;
            actorKind: "person" | "agent";
            accountId?: string;
          }
        | undefined,
      prediction?: LearningPrediction,
    ): Promise<IdentityContext> {
      const result = blank();
      const now = Date.now();
      if (auth) {
        const record: BrowserAssociation = {
          ...auth,
          id: await label(
            JSON.stringify([
              "browser-association-v1",
              identity.visitorId,
              auth.subjectId,
              auth.accountId ?? "",
              auth.actorId,
            ]),
          ),
          scope: await scope,
          visitorId: identity.visitorId,
          seenAt: now,
          expiresAt: now + retentionDays * 86_400_000,
        };
        await storage.remember(record);
        return {
          ...result,
          status: "authenticated",
          basis: "authentication",
          candidates: [{ ...auth, lastSeenAt: now }],
        };
      }
      const cookie = cookieId === identity.visitorId && identity.isReturning;
      const previous = cookie
        ? identity.visitorId
        : identity.browserMatch?.visitorId;
      if (previous) {
        const rows = await storage.recall(await scope, previous, now, 11);
        result.truncated = rows.length > 10;
        result.candidates = rows
          .slice(0, 10)
          .map((r) => ({
            subjectId: r.subjectId,
            accountId: r.accountId,
            actorId: r.actorId,
            actorKind: r.actorKind,
            lastSeenAt: r.seenAt,
            ...(!cookie ? { score: identity.browserMatch!.score } : {}),
          }));
        if (rows.length) {
          result.basis = cookie ? "cookie-history" : "browser-similarity";
          result.status =
            rows.length > 1 ? "ambiguous" : cookie ? "remembered" : "inferred";
          return result;
        }
      }
      if (
        prediction?.status === "suggested" &&
        prediction.subjectId &&
        prediction.score !== undefined
      )
        return {
          ...result,
          status: "inferred",
          basis: "login-history",
          candidates: [
            { subjectId: prediction.subjectId, score: prediction.score },
          ],
        };
      return result;
    },
    async forgetUser(userId: string) {
      const subject = await label(id.parse(userId));
      await storage.forget(await scope, subject);
      await directory.deleteSubject(subject);
    },
    async cleanup() {
      await storage.cleanupContext(await scope, Date.now());
    },
  };
}
