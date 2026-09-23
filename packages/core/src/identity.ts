/** Directory records contain opaque references, never raw identity keys or credentials. */
export type IdentitySubject = {
  id: string;
  kind: "person" | "agent";
  updatedAt: number;
};
export type IdentityKey = {
  digest: string;
  subjectId: string;
  type: "email" | "external" | "public-key";
  issuer: string;
  verifiedAt: number;
};
export type Delegation = {
  id: string;
  principalId: string;
  actorId: string;
  audience: string;
  scopes: string[];
  expiresAt: number;
  revokedAt?: number;
};
export interface IdentityStorage {
  putSubject(subject: IdentitySubject): Promise<void>;
  getSubject(id: string): Promise<IdentitySubject | undefined>;
  deleteSubject(id: string): Promise<void>;
  putKey(key: IdentityKey): Promise<void>;
  getKey(digest: string): Promise<IdentityKey | undefined>;
  deleteKey(subjectId: string, digest: string): Promise<void>;
  putDelegation(grant: Delegation): Promise<void>;
  getDelegation(id: string): Promise<Delegation | undefined>;
  revokeDelegation(id: string, now: number): Promise<void>;
  cleanupIdentity(now: number): Promise<void>;
}
/** Trusted server context after authentication; never copy claims from a request body. */
export type VerifiedIdentityContext = {
  subjectId: string;
  actorId?: string;
  delegationId?: string;
  audience?: string;
  requiredScopes?: readonly string[];
};
export type IdentityAttribution = {
  subject: { id?: string; status: "verified" | "unknown" };
  actor: {
    id?: string;
    kind: "person" | "agent" | "unknown";
    basis: "verified-credential" | "unknown";
  };
  delegation: {
    status: "none" | "valid" | "invalid";
    id?: string;
    reason?:
      | "missing"
      | "revoked"
      | "expired"
      | "principal"
      | "actor"
      | "audience"
      | "scope";
    scopes?: string[];
    expiresAt?: number;
  };
};

/** Delegation is checked deterministically, separately from browser/AI risk. */
export async function assessIdentity(
  storage: IdentityStorage,
  context?: VerifiedIdentityContext,
  now = Date.now(),
): Promise<IdentityAttribution> {
  const result: IdentityAttribution = {
    subject: { status: "unknown" },
    actor: { kind: "unknown", basis: "unknown" },
    delegation: { status: "none" },
  };
  if (!context) return result;
  const subject = await storage.getSubject(context.subjectId);
  const actor = context.actorId
    ? await storage.getSubject(context.actorId)
    : undefined;
  if (subject) result.subject = { id: subject.id, status: "verified" };
  if (actor)
    result.actor = {
      id: actor.id,
      kind: actor.kind,
      basis: "verified-credential",
    };
  if (!context.delegationId) return result;
  const grant = await storage.getDelegation(context.delegationId);
  const reason = !grant
    ? "missing"
    : grant.revokedAt !== undefined
      ? "revoked"
      : grant.expiresAt <= now
        ? "expired"
        : !subject || grant.principalId !== subject.id
          ? "principal"
          : !actor || grant.actorId !== actor.id
            ? "actor"
            : !context.audience || grant.audience !== context.audience
              ? "audience"
              : (context.requiredScopes ?? []).some(
                    (scope) => !grant.scopes.includes(scope),
                  )
                ? "scope"
                : undefined;
  result.delegation = reason
    ? { id: context.delegationId, status: "invalid", reason }
    : {
        id: grant!.id,
        status: "valid",
        scopes: grant!.scopes,
        expiresAt: grant!.expiresAt,
      };
  return result;
}

/** Validate the optional browser response without pulling a schema library into the bundle. */
export function isIdentityAttribution(
  value: unknown,
): value is IdentityAttribution {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !record(value) ||
    !record(value.subject) ||
    !record(value.actor) ||
    !record(value.delegation)
  )
    return false;
  const { subject, actor, delegation } = value;
  const id = (v: unknown) =>
    typeof v === "string" && /^sub_[a-f0-9]{64}$/.test(v);
  if (!(
    (subject.status === "unknown" && subject.id === undefined) ||
    (subject.status === "verified" && id(subject.id))
  ))
    return false;
  if (!(
    (actor.kind === "unknown" &&
      actor.basis === "unknown" &&
      actor.id === undefined) ||
    ((actor.kind === "person" || actor.kind === "agent") &&
      actor.basis === "verified-credential" &&
      id(actor.id))
  ))
    return false;
  if (delegation.status === "none") return delegation.id === undefined;
  if (
    typeof delegation.id !== "string" ||
    !/^dlg_[a-f0-9]{48}$/.test(delegation.id)
  )
    return false;
  if (delegation.status === "invalid")
    return [
      "missing",
      "revoked",
      "expired",
      "principal",
      "actor",
      "audience",
      "scope",
    ].includes(String(delegation.reason));
  return (
    delegation.status === "valid" &&
    typeof delegation.expiresAt === "number" &&
    Number.isSafeInteger(delegation.expiresAt) &&
    Array.isArray(delegation.scopes) &&
    delegation.scopes.length > 0 &&
    delegation.scopes.length <= 32 &&
    delegation.scopes.every(
      (scope) =>
        typeof scope === "string" && scope.length > 0 && scope.length <= 256,
    )
  );
}
