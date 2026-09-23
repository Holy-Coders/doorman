import { z } from "zod";
import { assessIdentity } from "@aarondovturkel/doorman-core";
import type { IdentityStorage, VerifiedIdentityContext } from "@aarondovturkel/doorman-core";
import { createSubjectLinker } from "./subject.js";
import type { SubjectLinkingOptions } from "./subject.js";

const reference = z.string().regex(/^sub_[a-f0-9]{64}$/);
const grantId = z.string().regex(/^dlg_[a-f0-9]{48}$/);
const label = z.string().trim().min(1).max(256);
const scopes = z.array(label).min(1).max(32);
const keySchema = z
  .object({
    type: z.enum(["email", "external", "public-key"]),
    issuer: label,
    value: z.string().trim().min(1).max(512),
  })
  .strict();
export type VerifiedKeyInput = z.infer<typeof keySchema>;
const contextSchema = z
  .object({
    subjectId: reference,
    actorId: reference.optional(),
    delegationId: grantId.optional(),
    audience: label.optional(),
    requiredScopes: z.array(label).max(32).optional(),
  })
  .strict();

/** Server-only management API. The application verifies ownership and authorizes every mutation. */
export function createIdentityDirectory(
  storage: IdentityStorage,
  options: SubjectLinkingOptions,
) {
  const subjectLabel = createSubjectLinker(options);
  // Key inputs include a version and type; their digest lives in a separate table.
  const keyLabel = createSubjectLinker({
    ...options,
    namespace: options.namespace,
  });
  async function digest(input: VerifiedKeyInput) {
    const key = keySchema.parse(input);
    if (key.type === "email") {
      const email = z.string().email().max(254).parse(key.value);
      const separator = email.lastIndexOf("@");
      key.value =
        email.slice(0, separator) +
        "@" +
        email.slice(separator + 1).toLowerCase();
    }
    return {
      ...key,
      digest: await keyLabel(
        JSON.stringify(["identity-key-v1", key.type, key.issuer, key.value]),
      ),
    };
  }
  async function requireSubject(id: string) {
    const subject = await storage.getSubject(reference.parse(id));
    if (!subject) throw new Error("Unknown identity subject");
    return subject;
  }
  return {
    async updateSubject(input: { id: string; kind: "person" | "agent" }) {
      const parsed = z
        .object({
          id: z.string().min(1).max(512),
          kind: z.enum(["person", "agent"]),
        })
        .strict()
        .parse(input);
      const subject = {
        id: await subjectLabel(parsed.id),
        kind: parsed.kind,
        updatedAt: Date.now(),
      };
      await storage.putSubject(subject);
      return subject;
    },
    async addVerifiedKey(subjectId: string, input: VerifiedKeyInput) {
      await requireSubject(subjectId);
      const key = await digest(input);
      await storage.putKey({
        digest: key.digest,
        subjectId,
        type: key.type,
        issuer: key.issuer,
        verifiedAt: Date.now(),
      });
    },
    async findSubject(input: VerifiedKeyInput) {
      const key = await storage.getKey((await digest(input)).digest);
      return key ? storage.getSubject(key.subjectId) : undefined;
    },
    async removeKey(subjectId: string, input: VerifiedKeyInput) {
      await storage.deleteKey(
        reference.parse(subjectId),
        (await digest(input)).digest,
      );
    },
    async deleteSubject(subjectId: string) {
      await storage.deleteSubject(reference.parse(subjectId));
    },
    async createDelegation(input: {
      principalId: string;
      actorId: string;
      audience: string;
      scopes: string[];
      expiresAt: number;
    }) {
      const parsed = z
        .object({
          principalId: reference,
          actorId: reference,
          audience: label,
          scopes,
          expiresAt: z.number().int().safe(),
        })
        .strict()
        .parse(input);
      const now = Date.now();
      if (parsed.expiresAt <= now || parsed.expiresAt > now + 30 * 86400000)
        throw new Error("Delegation must expire within 30 days");
      if (parsed.principalId === parsed.actorId)
        throw new Error("Delegation requires a distinct actor");
      await requireSubject(parsed.principalId);
      await requireSubject(parsed.actorId);
      const grant = {
        ...parsed,
        scopes: [...new Set(parsed.scopes)].sort(),
        id:
          "dlg_" +
          Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
      };
      await storage.putDelegation(grant);
      return grant;
    },
    async revokeDelegation(id: string) {
      await storage.revokeDelegation(grantId.parse(id), Date.now());
    },
    async assess(context?: VerifiedIdentityContext) {
      return assessIdentity(
        storage,
        context === undefined ? undefined : contextSchema.parse(context),
      );
    },
    cleanup: () => storage.cleanupIdentity(Date.now()),
  };
}
