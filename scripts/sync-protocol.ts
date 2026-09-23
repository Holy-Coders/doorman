import {
  operatorWindowInputSchema,
  operatorEvidenceSchema,
} from "../packages/adapters/src/operators.js";
import { operatorStudySchema } from "../packages/network/src/operator-study.js";
import {
  classifierAssessmentSchema,
  classifierDatasetSchema,
  classifierModelSchema,
} from "../packages/network/src/classifier-schema.js";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { z } from "zod";
import { payloadSchema } from "../packages/adapters/src/validation.js";
import {
  featureSchema,
  contributionSchema,
  feedbackSchema,
  preferencesSchema,
  evaluationSchema,
} from "../packages/network/src/schema.js";
import { assessmentSchema } from "../packages/network/src/client.js";
import {
  JEV_QUESTIONS,
  INTELLIGENCE_QUESTIONS,
  API_ACTIVITY_QUESTIONS,
  createActivityInput,
  createJevInput,
} from "@aarondovturkel/doorman-evaluator-jev";
import {
  normalizeObservation,
  calculateSimilarity,
  evidenceCap,
  hasContradiction,
} from "@aarondovturkel/doorman-core";
import { signals, phone } from "../tests/helpers/fixtures.js";
import { createSubjectLinker } from "../packages/adapters/src/subject.js";
const schema = z.toJSONSchema(payloadSchema);
writeFileSync(
  "protocol/operators.schema.json",
  JSON.stringify(
    {
      version: 1,
      description:
        "Private TypeScript server API and controlled-run reference fitting. No public endpoint is installed. Temporal, account authorization and semantic constraints are additionally enforced by the application and service.",
      window: z.toJSONSchema(operatorWindowInputSchema),
      evidence: z.toJSONSchema(operatorEvidenceSchema),
      study: z.toJSONSchema(operatorStudySchema),
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "protocol/network.schema.json",
  JSON.stringify(
    {
      version: 1,
      description:
        "Server-to-server learning pilot. Outcome provenance constraints are additionally enforced by the service; model predictions and login alone are not valid labels.",
      features: z.toJSONSchema(featureSchema),
      contribution: z.toJSONSchema(contributionSchema),
      feedback: z.toJSONSchema(feedbackSchema),
      preferences: z.toJSONSchema(preferencesSchema),
      evaluation: z.toJSONSchema(evaluationSchema),
      assessment: z.toJSONSchema(assessmentSchema),
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "protocol/classifier.schema.json",
  JSON.stringify(
    {
      version: 1,
      description:
        "Operator training artifacts and private /v1/classify response. Additional semantic constraints are enforced by Doorman.",
      dataset: z.toJSONSchema(classifierDatasetSchema),
      model: z.toJSONSchema(classifierModelSchema),
      assessment: z.toJSONSchema(classifierAssessmentSchema),
    },
    null,
    2,
  ) + "\n",
);
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
  evidenceLabels: await Promise.all(
    [
      ["scope", "application"],
      ["event", "event-משתמש"],
      ["session", "session-123"],
      ["verification", ["auth", "proof-123"]],
    ].map(async ([purpose, value]) => ({
      purpose,
      value,
      expected: await createSubjectLinker({
        secret: "a".repeat(64),
        namespace: "fixture",
      })(JSON.stringify(["evidence-v1", purpose, value])),
    })),
  ),
  protectionLabels: await Promise.all(
    [
      "global",
      "evaluator",
      JSON.stringify(["account", "account-123"]),
      JSON.stringify(["global-shard-v1", 4, 0]),
    ].map(async (value) => ({
      value,
      expected: await createSubjectLinker({
        secret: "a".repeat(64),
        namespace: "fixture",
      })(JSON.stringify(["protection-v1", value])),
    })),
  ),
  activity: createActivityInput({
    activity: {
      source: "application-api",
      observedAt: 123,
      windowMs: 60000,
      truncated: false,
      buckets: [],
    },
    route: "GET /api/orders/:id",
    sensitive: true,
    actor: { kind: "agent", delegated: true },
  }),
  activityLabel: await createSubjectLinker({
    secret: "a".repeat(64),
    namespace: "fixture",
  })(JSON.stringify(["api-activity-v1", "actor", "private-actor"])),
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
  writeFileSync(
    `${dir}/jev-activity.json`,
    JSON.stringify(API_ACTIVITY_QUESTIONS, null, 2) + "\n",
  );
  writeFileSync(
    `${dir}/jev-intelligence.json`,
    JSON.stringify(INTELLIGENCE_QUESTIONS, null, 2) + "\n",
  );
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
  "0005_protection",
  "0006_evidence",
  "0007_learning_lookup",
  "0008_api_activity",
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
        title: "Doorman first-party browser protocol",
        version: "0.9.0",
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
