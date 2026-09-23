import { expect, it, vi } from "vitest";
import { SignJWT, EncryptJWT, generateKeyPair } from "jose";
import {
  createResultReceipts,
  verifyAgentCredential,
} from "@janitor/adapters/security";
import {
  createAnalyticsBridge,
  analyticsProperties,
} from "@janitor/adapters/analytics";
import {
  createFeedbackExport,
  revokeFeedback,
  evaluateLearning,
  type EvaluationRow,
  type VisitorIdentity,
} from "@janitor/core";
const identity: VisitorIdentity = {
  visitorId: `vis_${"a".repeat(48)}`,
  confidence: 0.9,
  isReturning: true,
  risk: { automation: 0.1, suspicious: 0.2 },
  riskStatus: "evaluated",
  debug: {
    deterministicScore: 1,
    evaluatorUsed: false,
    candidateCount: 1,
    collectedSignals: { userAgent: "private" },
  },
};

it("encrypts an operation-specific result, excludes debug, rejects replay and tampering", async () => {
  const receipts = createResultReceipts({
    secret: crypto.getRandomValues(new Uint8Array(32)),
    issuer: "app",
  });
  const token = await receipts.issue({
    identity,
    audience: "checkout",
    operationId: "order-1",
    action: "payment",
  });
  expect(token.split(".")).toHaveLength(5);
  const visible = token
    .split(".")
    .map((part) => Buffer.from(part, "base64url").toString("utf8"))
    .join("");
  expect(visible).not.toMatch(/automation|suspicious|confidence|vis_|private/);
  const consumed = new Set<string>();
  const consumeNonce = vi.fn(async (nonce: string) => {
    if (consumed.has(nonce)) return false;
    consumed.add(nonce);
    return true;
  });
  const expected = {
    audience: "checkout",
    operationId: "order-1",
    action: "payment" as const,
    consumeNonce,
  };
  for (const change of [
    { audience: "other" },
    { operationId: "order-2" },
    { action: "read" as const },
  ])
    expect(
      await receipts.verify(token, { ...expected, ...change }),
    ).toBeUndefined();
  expect(consumeNonce).not.toHaveBeenCalled();
  const result = await receipts.verify(token, expected);
  expect(result?.risk).toEqual(identity.risk);
  expect(result).not.toHaveProperty("debug");
  expect(await receipts.verify(token, expected)).toBeUndefined();
  expect(
    await receipts.verify(token.slice(0, -12) + "tampering123", expected),
  ).toBeUndefined();
});
it("rejects expired receipts, cross-purpose tokens and nonce storage failures", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const receipts = createResultReceipts({ secret, issuer: "app" });
  const expected = {
    audience: "a",
    operationId: "o",
    action: "read" as const,
    consumeNonce: async () => true,
  };
  const expired = await new EncryptJWT({
    identity,
    operationId: "o",
    action: "read",
  })
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
      typ: "janitor-result+jwe",
    })
    .setIssuer("app")
    .setAudience("a")
    .setIssuedAt(1)
    .setExpirationTime(2)
    .setJti(crypto.randomUUID())
    .encrypt(secret);
  expect(await receipts.verify(expired, expected)).toBeUndefined();
  const token = await receipts.issue({
    identity,
    audience: "a",
    operationId: "o",
    action: "read",
  });
  expect(
    await receipts.verify(token, {
      ...expected,
      consumeNonce: async () => {
        throw Error("db");
      },
    }),
  ).toBeUndefined();
  await expect(
    receipts.issue({
      identity,
      audience: "a",
      operationId: "o",
      action: "read",
      ttlSeconds: 301,
    }),
  ).rejects.toThrow();
});
it("rejects unencrypted legacy receipts and a different encryption key", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const receipts = createResultReceipts({ secret, issuer: "app" });
  const input = {
    identity,
    audience: "a",
    operationId: "o",
    action: "read" as const,
  };
  const consumeNonce = vi.fn(async () => true);
  const expected = {
    audience: "a",
    operationId: "o",
    action: "read" as const,
    consumeNonce,
  };
  const legacy = await new SignJWT(input)
    .setProtectedHeader({ alg: "HS256", typ: "janitor-result+jwt" })
    .setIssuer("app")
    .setAudience("a")
    .setIssuedAt()
    .setExpirationTime("1m")
    .setJti(crypto.randomUUID())
    .sign(secret);
  expect(await receipts.verify(legacy, expected)).toBeUndefined();
  const wrong = createResultReceipts({
    secret: crypto.getRandomValues(new Uint8Array(32)),
    issuer: "app",
  });
  expect(
    await wrong.verify(await receipts.issue(input), expected),
  ).toBeUndefined();
  expect(consumeNonce).not.toHaveBeenCalled();
});
it("verifies an issuer credential separately from user delegation", async () => {
  const keys = await generateKeyPair("ES256");
  const token = await new SignJWT({ kind: "agent" })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer("trusted")
    .setAudience("my-app")
    .setSubject("agent-17")
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(keys.privateKey);
  const options = {
    key: keys.publicKey,
    issuer: "trusted",
    audience: "my-app",
    algorithms: ["ES256" as const],
    isAgent: (c: Readonly<Record<string, unknown>>) => c.kind === "agent",
  };
  expect(await verifyAgentCredential(token, options)).toEqual({
    issuer: "trusted",
    subject: "agent-17",
  });
  expect(
    await verifyAgentCredential(token, { ...options, audience: "wrong" }),
  ).toBeUndefined();
  expect(
    await verifyAgentCredential(token, { ...options, isAgent: () => false }),
  ).toBeUndefined();
  expect(
    await verifyAgentCredential(token, { ...options, algorithms: ["RS256"] }),
  ).toBeUndefined();
  expect(
    await verifyAgentCredential(token, { ...options, issuer: "attacker" }),
  ).toBeUndefined();
});
it("analytics bridges export allowlisted properties and explicit authenticated profile updates", async () => {
  const capture = vi.fn(),
    identify = vi.fn(),
    track = vi.fn(),
    set = vi.fn();
  const clients = [
    createAnalyticsBridge({
      provider: "posthog",
      client: { capture, identify },
    }),
    createAnalyticsBridge({
      provider: "mixpanel",
      client: { track, people: { set } },
    }),
    createAnalyticsBridge({ provider: "segment", client: { track, identify } }),
  ];
  for (const bridge of clients) {
    expect(await bridge.capture(identity, "account")).toEqual({
      status: "queued",
    });
    await bridge.identifyUser("account", {
      email: "user@example.test",
      plan: "pro",
      password: "hidden",
    } as { email: string });
  }
  expect(
    JSON.stringify([
      capture.mock.calls,
      identify.mock.calls,
      track.mock.calls,
      set.mock.calls,
    ]),
  ).not.toMatch(/private|hidden|password|collectedSignals/);
  expect(set.mock.calls[0]).toEqual([
    "account",
    { $email: "user@example.test", plan: "pro", ip: "0" },
  ]);
  expect(analyticsProperties(identity)).toHaveProperty(
    "janitor_risk_status",
    "evaluated",
  );
});
it("SDK bridge reports synchronous failures without changing the caller's identity", async () => {
  const bridge = createAnalyticsBridge({
    provider: "posthog",
    client: {
      capture: () => {
        throw Error("down");
      },
      identify: () => {},
    },
  });
  expect(await bridge.capture(identity, "account")).toEqual({
    status: "unavailable",
  });
  expect(() => bridge.identifyUser("", {})).toThrow();
});
const row = (
  id: string,
  subject: string,
  device: string,
  observedAt: number,
  verifiedAt = observedAt + 1,
): EvaluationRow => ({
  sessionId: id,
  subjectId: subject,
  deviceId: device,
  observedAt,
  verifiedAt,
  observation: { platform: "macos" },
  prediction: { status: "not-run" },
});
it("evaluation holds out future labels and the current physical device", async () => {
  const data = createFeedbackExport([
    row("a", "one", "laptop", 1),
    row("b", "one", "phone", 10),
    row("c", "two", "laptop", 20),
    row("d", "two", "tablet", 30, 100),
  ]);
  const predict = vi.fn(
    async ({ examples }: { examples: { subjectId: string }[] }) => ({
      subjectId: examples[0]!.subjectId,
      score: 0.8,
    }),
  );
  const report = await evaluateLearning(data, { deviceHoldout: true, predict });
  expect(report).toMatchObject({
    trials: 4,
    correct: 2,
    incorrect: 1,
    abstained: 1,
    knownAccountTrials: 2,
    precision: 2 / 3,
  });
  expect(predict.mock.calls[0]![0].examples).toHaveLength(1);
  expect(predict.mock.calls[1]![0].examples).toHaveLength(1);
  for (const [input] of predict.mock.calls)
    for (const e of input.examples) expect(e).not.toHaveProperty("prediction");
  expect(JSON.stringify(report)).not.toContain("macos");
});
it("revocations remove exported rows and preserve deletion lineage", async () => {
  const data = createFeedbackExport([
    row("a", "one", "laptop", 1),
    row("b", "one", "phone", 10),
  ]);
  const revoked = revokeFeedback(data, ["a"]);
  expect(revoked.revokedSessionIds).toEqual(["a"]);
  expect(data.rows).toHaveLength(2);
  const report = await evaluateLearning(revoked, {
    predict: async () => {
      throw Error("no examples");
    },
  });
  expect(report).toMatchObject({ trials: 1, abstained: 1, precision: null });
});
it("evaluation counts unavailable and out-of-cohort predictions, never learns its own guess", async () => {
  const data = createFeedbackExport([
    row("a", "one", "laptop", 1),
    row("b", "one", "phone", 10),
  ]);
  expect(
    await evaluateLearning(data, {
      predict: async () => ({ subjectId: "unknown", score: 1 }),
    }),
  ).toMatchObject({ unavailable: 1, correct: 0 });
  expect(
    await evaluateLearning(data, {
      timeoutMs: 1,
      predict: async () => new Promise(() => {}),
    }),
  ).toMatchObject({ unavailable: 1 });
  await expect(
    evaluateLearning(createFeedbackExport([row("a", "one", "phone", 10, 1)]), {
      predict: async () => ({}),
    }),
  ).rejects.toThrow();
});
