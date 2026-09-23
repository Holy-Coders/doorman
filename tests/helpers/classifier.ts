import type {
  ClassifierCandidate,
  ClassifierDataset,
} from "../../packages/network/src/classifier-schema.js";
import { finalizeClassifier } from "../../packages/network/src/classifier-evaluation.js";
export const candidate: ClassifierCandidate = {
  name: "telemetry-logistic",
  mode: "telemetry",
  parameters: {
    columns: [
      { name: "api_gap_cv", mean: 0, scale: 1 },
      { name: "api_sequence_repeat_ratio", mean: 0, scale: 1 },
    ],
    estimator: { kind: "logistic", weights: [-12, 24], bias: -12 },
    calibration: { slope: 1, bias: 0 },
  },
};
export const simpleModel = (data: ClassifierDataset) =>
  finalizeClassifier(data, {
    version: 1,
    datasetDigest: data.manifest.digest,
    trainerVersion: "test-numeric-fixture",
    candidates: [candidate],
  });
