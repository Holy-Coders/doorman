import { EncryptJWT, jwtDecrypt, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { VisitorIdentity } from "@janitor/core";

const label = z.string().min(1).max(256);
const probability = z.number().finite().min(0).max(1);
const resultSchema = z
  .object({
    visitorId: z.string().regex(/^vis_[a-f0-9]{48}$/),
    confidence: probability,
    isReturning: z.boolean(),
    risk: z
      .object({ automation: probability, suspicious: probability })
      .strict(),
    riskStatus: z.enum(["evaluated", "unavailable", "disabled"]),
  })
  .strict();
const actions = z.enum([
  "sign-in",
  "payment",
  "profile-update",
  "read",
  "other",
]);
export type ActionCategory = z.infer<typeof actions>;
export type ConsumeNonce = (
  nonce: string,
  expiresAt: number,
) => Promise<boolean>;

/** Authenticated, encrypted evidence for an application-owned operation, not an authentication credential. */
export function createResultReceipts(options: {
  secret: Uint8Array;
  issuer: string;
}) {
  if (options.secret.byteLength !== 32)
    throw new Error("Receipt secret needs exactly 32 random bytes");
  const key = options.secret.slice();
  const issuer = label.parse(options.issuer);
  return {
    async issue(input: {
      identity: VisitorIdentity;
      audience: string;
      operationId: string;
      action: ActionCategory;
      ttlSeconds?: number;
    }) {
      const ttl = z
        .number()
        .int()
        .min(1)
        .max(300)
        .parse(input.ttlSeconds ?? 60);
      const { visitorId, confidence, isReturning, risk, riskStatus } =
        input.identity;
      const identity = resultSchema.parse({
        visitorId,
        confidence,
        isReturning,
        risk,
        riskStatus,
      });
      return new EncryptJWT({
        identity,
        operationId: label.parse(input.operationId),
        action: actions.parse(input.action),
      })
        .setProtectedHeader({
          alg: "dir",
          enc: "A256GCM",
          typ: "janitor-result+jwe",
        })
        .setIssuer(issuer)
        .setAudience(label.parse(input.audience))
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
        .setJti(crypto.randomUUID())
        .encrypt(key);
    },
    async verify(
      token: string,
      expected: {
        audience: string;
        operationId: string;
        action: ActionCategory;
        consumeNonce: ConsumeNonce;
      },
    ) {
      try {
        if (token.length > 8192) return undefined;
        const { payload } = await jwtDecrypt(token, key, {
          issuer,
          audience: label.parse(expected.audience),
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
          typ: "janitor-result+jwe",
          maxTokenAge: 300,
          requiredClaims: ["exp", "iat", "jti"],
        });
        const now = Math.floor(Date.now() / 1000);
        if (
          !Number.isInteger(payload.exp) ||
          !Number.isInteger(payload.iat) ||
          payload.exp! - payload.iat! > 300 ||
          payload.iat! > now ||
          payload.operationId !== label.parse(expected.operationId) ||
          payload.action !== actions.parse(expected.action) ||
          !z.string().uuid().safeParse(payload.jti).success
        )
          return undefined;
        const identity = resultSchema.parse(payload.identity);
        // The implementer must atomically insert a nonce with a uniqueness constraint.
        if (
          !(await expected.consumeNonce(
            `${issuer}:result:${payload.jti}`,
            payload.exp! * 1000,
          ))
        )
          return undefined;
        return identity;
      } catch {
        return undefined;
      }
    },
  };
}

/** Verify a preconfigured issuer's credential. Never discover key URLs from token headers. */
export async function verifyAgentCredential(
  token: string,
  options: {
    key: CryptoKey | JWTVerifyGetKey;
    issuer: string;
    audience: string;
    algorithms: ("EdDSA" | "ES256" | "RS256" | "PS256")[];
    /** Provider-specific claim check; a signed JWT alone does not identify an agent. */
    isAgent: (claims: Readonly<Record<string, unknown>>) => boolean;
  },
) {
  try {
    if (
      token.length > 16384 ||
      options.algorithms.length === 0 ||
      !options.algorithms.every((a) =>
        ["EdDSA", "ES256", "RS256", "PS256"].includes(a),
      )
    )
      return undefined;
    const { payload } = await jwtVerify(token, options.key as JWTVerifyGetKey, {
      issuer: label.parse(options.issuer),
      audience: label.parse(options.audience),
      algorithms: options.algorithms,
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (
      !Number.isInteger(payload.exp) ||
      !Number.isInteger(payload.iat) ||
      payload.iat! > Math.floor(Date.now() / 1000) ||
      options.isAgent(payload) !== true
    )
      return undefined;
    return { issuer: options.issuer, subject: label.parse(payload.sub) };
  } catch {
    return undefined;
  }
}
