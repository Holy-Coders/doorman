import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { z } from "zod";
import { payloadSchema } from "../packages/adapters/src/validation.js";
import { JEV_QUESTIONS, createJevInput } from "@janitor/evaluator-jev";
import {
  normalizeObservation,
  calculateSimilarity,
  evidenceCap,
  hasContradiction,
} from "@janitor/core";
import { signals, phone } from "../tests/helpers/fixtures.js";
import { createSubjectLinker } from "../packages/adapters/src/subject.js";
const schema = z.toJSONSchema(payloadSchema);
const scenarios = [
  signals,
  {
    ...signals,
    userAgent: signals.userAgent!.replace("130.0.0.0", "131.2.0.0"),
  },
  { ...signals, screen: { ...signals.screen, width: 900, height: 1440 } },
  { ...signals, timezone: "Europe/London" },
  { ...signals, graphics: undefined },
  { ...signals, viewport: { width: 390, height: 700 } },
  phone,
  {},
  {
    platform: " Win32 ",
    languages: ["he", "EN-us", "", "he"],
    screen: { width: 0, height: 0 },
  },
];
const current = normalizeObservation(signals);
const vectors = await Promise.all(
  scenarios.map(async (raw) => ({
    raw,
    normalized: normalizeObservation(raw),
    similarity: calculateSimilarity(current, normalizeObservation(raw)),
    cap: evidenceCap(current, normalizeObservation(raw)),
    contradiction: hasContradiction(current, normalizeObservation(raw)),
  })),
);
const shared = {
  reference: current,
  vectors,
  jev: createJevInput({
    history: [current],
    current,
    deterministicSimilarity: 1,
  }),
  subjects: await Promise.all(
    ["account-123", "משתמש", "é", 'a"b'].map(async (id) => ({
      id,
      namespace: "fixture",
      secret: "a".repeat(64),
      expected: await createSubjectLinker({
        secret: "a".repeat(64),
        namespace: "fixture",
      })(id),
    })),
  ),
};
for (const dir of ["protocol", "packages/elixir/priv"]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/payload.schema.json`,
    JSON.stringify(schema, null, 2) + "\n",
  );
  writeFileSync(
    `${dir}/conformance.json`,
    JSON.stringify(shared, null, 2) + "\n",
  );
  writeFileSync(
    `${dir}/jev-questions.json`,
    JSON.stringify(JEV_QUESTIONS, null, 2) + "\n",
  );
}
for (const migration of [
  "0001_visitors",
  "0002_identity",
  "0003_learning",
  "0004_candidate_lookup",
])
  copyFileSync(
    `packages/storage/postgres/migrations/${migration}.sql`,
    `packages/elixir/priv/migrations/${migration}.sql`,
  );
const identitySchema = {
  type: "object",
  required: ["visitorId", "confidence", "isReturning", "risk", "riskStatus"],
  properties: {
    visitorId: { type: "string", pattern: "^vis_[a-f0-9]{48}$" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    isReturning: { type: "boolean" },
    risk: {
      type: "object",
      required: ["automation", "suspicious"],
      properties: {
        automation: { type: "number", minimum: 0, maximum: 1 },
        suspicious: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    riskStatus: { enum: ["evaluated", "unavailable", "disabled"] },
    attribution: {
      type: "object",
      description:
        "Optional server-verified identity attribution; see docs/AGENTIC-IDENTITY.md.",
    },
    subjectId: { type: "string", pattern: "^sub_[a-f0-9]{64}$" },
    debug: {
      type: "object",
      description: "Explicitly enabled non-production debug only.",
    },
  },
};
writeFileSync(
  "protocol/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Janitor first-party browser protocol",
        version: "0.6.0",
        description:
          "Self-hosted by each implementer. Measurements never establish authenticated account claims.",
      },
      paths: {
        "/api/visitor": {
          post: {
            operationId: "identifyVisitor",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/VisitorPayload" },
                },
              },
            },
            responses: {
              "200": {
                description:
                  "Browser continuity only by default; full scores require explicit server opt-in",
                headers: {
                  "Set-Cookie": {
                    description:
                      "First-party HttpOnly identity cookie; optional separate learning cookie.",
                    schema: { type: "string" },
                  },
                },
                content: {
                  "application/json": {
                    schema: {
                      oneOf: [
                        { $ref: "#/components/schemas/VisitorClientIdentity" },
                        { $ref: "#/components/schemas/VisitorIdentity" },
                      ],
                    },
                  },
                },
              },
              ...Object.fromEntries(
                [400, 403, 404, 405, 408, 413, 415, 503].map((code) => [
                  String(code),
                  {
                    description:
                      code === 503 ? "Storage unavailable" : "Request rejected",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          required: ["error"],
                          properties: { error: { type: "string" } },
                        },
                      },
                    },
                  },
                ]),
              ),
            },
          },
        },
      },
      components: {
        schemas: {
          VisitorPayload: schema,
          VisitorIdentity: identitySchema,
          VisitorClientIdentity: {
            type: "object",
            required: ["visitorId", "isReturning"],
            additionalProperties: false,
            properties: {
              visitorId: identitySchema.properties.visitorId,
              isReturning: { type: "boolean" },
            },
          },
        },
      },
    },
    null,
    2,
  ) + "\n",
);
