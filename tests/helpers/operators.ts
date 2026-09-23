import type {
  OperatorEvaluation,
  OperatorEvidence,
  OperatorKind,
  OperatorWindow,
} from "@aarondovturkel/doorman-core";
export const evidence: OperatorEvidence = {
  source: "server",
  features: {
    observation_duration_ms: 60_000,
    api_request_count: 100,
    api_gap_cv: 0.1,
    api_sequence_repeat_ratio: 0.9,
  },
};
export function evaluation(
  kind: OperatorKind = "assistant",
): OperatorEvaluation {
  return {
    modelVersion: "fixture-v1",
    scores: {
      human: kind === "human" ? 0.96 : 0.1,
      assistant: kind === "assistant" ? 0.97 : 0.1,
      automation: kind === "automation" ? 0.97 : 0.1,
    },
    abuse: 0.02,
    families: [],
    links: [],
  };
}
export function window(
  id: string,
  kind: OperatorKind = "assistant",
  links: { windowId: string; score: number }[] = [],
): OperatorWindow {
  return {
    id,
    accountKey: "acct",
    sessionKey: `session-${id}`,
    browserKey: "browser-a",
    startedAt: 100,
    endedAt: 200,
    expiresAt: 10000,
    inputDigest: id,
    lease: `lease-${id}`,
    evidence,
    status: "evaluated",
    evaluation: { ...evaluation(kind), links },
  };
}
