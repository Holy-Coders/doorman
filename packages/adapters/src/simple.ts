import type { AdapterOptions } from "./handler.js";
import type { SubjectLinkingOptions } from "./subject.js";

export type SimpleOptions = Omit<
  AdapterOptions,
  | "identity"
  | "identityContext"
  | "learning"
  | "restoreBrowser"
  | "lookupPlanning"
  | "exposeClientScores"
> &
  SubjectLinkingOptions & {
    /** Collect independent login feedback and make private, uncalibrated suggestions. */
    crossDevice?: boolean;
    /** Create/update library tables automatically. Disable only for externally managed schemas. */
    autoMigrate?: boolean;
  };
export function simpleOptions(options: SimpleOptions): AdapterOptions {
  const identity = { secret: options.secret, namespace: options.namespace };
  return {
    identity,
    identityContext: true,
    exposeClientScores: false,
    restoreBrowser: false,
    classifyOperator: options.classifyOperator ?? true,
    lookupPlanning: false,
    learning: options.crossDevice
      ? { enabled: true, collectionPolicy: "application" }
      : false,
    // Shared database limits protect inference across handler instances/replicas.
    protection: options.protection ?? {
      ...identity,
      evaluator: { maxCalls: 60 },
    },
  };
}
