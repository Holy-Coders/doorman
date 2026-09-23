export { createNetworkClient, withNetworkRisk } from "./client.js";
export type { NetworkClient, NetworkClientOptions } from "./client.js";
export { extractFeatures, createSequenceTracker } from "./features.js";
export {
  discoverPatterns,
  matchPatterns,
  matches,
  PATTERN_GATES,
} from "./discovery.js";
export type {
  PatternModel,
  PatternMetrics,
  DiscoveryOptions,
  LearnedPattern,
} from "./discovery.js";
export { ROUTE_CATEGORIES, FEATURE_NAMES, parseFeatures } from "./schema.js";
export type {
  FeatureVector,
  RouteCategory,
  Contribution,
  Feedback,
  TrainingRow,
  NetworkPreferences,
  NetworkAssessment,
  NetworkRisk,
  PatternEvidence,
  Cohort,
} from "./schema.js";
