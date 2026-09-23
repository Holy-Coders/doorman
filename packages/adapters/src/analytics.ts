import {
  operatorWindowProperties,
  operatorSummaryProperties,
  operatorProfileProperties,
} from "./operator-analytics.js";
import type {
  OperatorAnalyticsContext,
  OperatorReportContext,
} from "./operator-analytics.js";
import type {
  OperatorWindow,
  OperatorSummary,
  OperatorProfile,
} from "@aarondovturkel/doorman-core";
export {
  operatorWindowProperties,
  operatorSummaryProperties,
  operatorProfileProperties,
} from "./operator-analytics.js";
export type {
  OperatorAnalyticsContext,
  OperatorReportContext,
} from "./operator-analytics.js";
import type {
  ApiActivityAssessment,
  IdentityAttribution,
  VisitorIdentity,
} from "@aarondovturkel/doorman-core";

/** An authenticated server agent can have attribution without a browser observation. */
export type AnalyticsAssessment = (
  VisitorIdentity | { attribution: IdentityAttribution }
) & { apiActivity?: ApiActivityAssessment };

export type AnalyticsContext = {
  /** Application-owned account/workspace, resolved from server authorization. */
  accountId?: string;
};
const validId = (value: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new Error("Authenticated analytics ID required");
  return value;
};

/** Pass to your existing SDK. Never export debug payloads or inferred account IDs. */
export function analyticsProperties(
  identity: AnalyticsAssessment,
  context: AnalyticsContext = {},
) {
  const actor = identity.attribution?.actor;
  const verifiedActor = actor?.basis === "verified-credential" && actor.id;
  const subject = identity.attribution?.subject;
  const browser = "visitorId" in identity ? identity : undefined;
  const api = identity.apiActivity;
  return Object.fromEntries(
    Object.entries({
      doorman_schema_version: 1,
      doorman_account_id:
        context.accountId === undefined
          ? undefined
          : validId(context.accountId),
      doorman_subject_id:
        subject?.status === "verified" ? subject.id : undefined,
      doorman_subject_status: subject?.status ?? "unknown",
      doorman_actor_id: verifiedActor ? actor.id : undefined,
      doorman_actor_basis: verifiedActor ? "verified-credential" : "unknown",
      doorman_visitor_id: browser?.visitorId,
      doorman_confidence: browser?.confidence,
      doorman_returning: browser?.isReturning,
      doorman_automation: browser?.risk.automation,
      doorman_suspicious: browser?.risk.suspicious,
      doorman_risk_status: browser?.riskStatus,
      doorman_actor_kind: verifiedActor ? actor.kind : "unknown",
      doorman_delegation_status: identity.attribution?.delegation.status,
      doorman_api_risk_status: api?.riskStatus,
      doorman_api_automation:
        api?.riskStatus === "evaluated" ? api.risk.automation : undefined,
      doorman_api_suspicious:
        api?.riskStatus === "evaluated" ? api.risk.suspicious : undefined,
      doorman_api_evaluated_at: api?.evaluatedAt,
      doorman_api_expires_at: api?.expiresAt,
      doorman_api_cached: api?.cached,
      doorman_api_window_ms: api?.summary.windowMs,
      doorman_api_requests: api?.summary.buckets.reduce(
        (total, bucket) => total + bucket.requests,
        0,
      ),
      doorman_api_truncated: api?.summary.truncated,
    }).filter(([, v]) => v !== undefined),
  );
}
export type ProfileTraits = { name?: string; email?: string; plan?: string };
type Property =
  string | number | boolean | null | undefined | { [key: string]: Property };
type Properties = Record<string, Property>;
type BridgeOptions =
  | {
      provider: "posthog";
      /** Optional provider group type; doorman_account_id is always an event property. */
      accountGroup?: string;
      client: {
        capture(event: {
          distinctId: string;
          event: string;
          properties: Properties;
          groups?: Record<string, string>;
        }): unknown;
        identify(event: {
          distinctId: string;
          properties: Properties;
        }): unknown;
      };
    }
  | {
      provider: "mixpanel";
      /** Configure this group key in Mixpanel first. Group Analytics is optional. */
      accountGroup?: string;
      identityMerge?: "simplified" | "original";
      client: {
        track(event: string, properties: Properties): unknown;
        people: { set(id: string, properties: Properties): unknown };
      };
    }
  | {
      provider: "segment" | "rudderstack";
      client: {
        track(event: {
          userId: string;
          event: string;
          properties: Properties;
        }): unknown;
        identify(event: { userId: string; traits: Properties }): unknown;
      };
    }
  | {
      provider: "amplitude";
      accountGroup?: string;
      client: {
        track(event: {
          event_type: string;
          user_id: string;
          event_properties?: Properties;
          user_properties?: Properties;
          groups?: Record<string, string>;
          insert_id: string;
          ip: string;
        }): unknown;
      };
    };
/** Server SDK bridge. SDKs own buffering, transport, regional config and shutdown/flush. */
export function createAnalyticsBridge(options: BridgeOptions) {
  const group = "accountGroup" in options ? options.accountGroup : undefined;
  if (
    group !== undefined &&
    (!/^[a-z][a-z0-9_]{0,63}$/.test(group) ||
      [
        "distinct_id",
        "ip",
        "token",
        "time",
        "event",
        "properties",
        "user_id",
      ].includes(group) ||
      (group.startsWith("doorman_") && group !== "doorman_account_id"))
  )
    throw new Error("Invalid analytics account group");
  const safe = async (send: () => unknown) => {
    try {
      const queued = send();
      const result =
        queued && typeof queued === "object" && "promise" in queued
          ? await queued.promise
          : await queued;
      if (
        result &&
        typeof result === "object" &&
        "code" in result &&
        typeof result.code === "number" &&
        result.code >= 300
      )
        return { status: "unavailable" as const };
      return { status: "queued" as const };
    } catch {
      return { status: "unavailable" as const };
    }
  };
  function send(
    event: string,
    properties: Properties,
    userId: string,
    context: AnalyticsContext,
  ) {
    return safe(() => {
      if (options.provider === "posthog")
        return options.client.capture({
          distinctId: userId,
          event,
          properties: { ...properties, $geoip_disable: true },
          ...(group && context.accountId
            ? { groups: { [group]: context.accountId } }
            : {}),
        });
      if (options.provider === "segment" || options.provider === "rudderstack")
        return options.client.track({ userId, event, properties });
      if (options.provider === "amplitude")
        return options.client.track({
          event_type: event,
          user_id: userId,
          event_properties: properties,
          ...(group && context.accountId
            ? { groups: { [group]: context.accountId } }
            : {}),
          insert_id: crypto.randomUUID(),
          ip: "0.0.0.0",
        });
      if (options.provider !== "mixpanel")
        throw new Error("Unknown analytics provider");
      return options.client.track(event, {
        ...properties,
        distinct_id: userId,
        ...(options.identityMerge !== "original" ? { $user_id: userId } : {}),
        ...(group && context.accountId ? { [group]: context.accountId } : {}),
        ip: 0,
      });
    });
  }
  return {
    capture(
      identity: AnalyticsAssessment,
      authenticatedId: string,
      context: AnalyticsContext = {},
    ) {
      return send(
        "doorman identified",
        analyticsProperties(identity, context),
        validId(authenticatedId),
        context,
      );
    },
    captureOperatorWindow(
      window: OperatorWindow,
      authenticatedId: string,
      context: OperatorAnalyticsContext,
    ) {
      return send(
        "doorman operator assessed",
        operatorWindowProperties(window, context),
        validId(authenticatedId),
        context,
      );
    },
    captureOperatorSummary(
      summary: OperatorSummary,
      authenticatedId: string,
      context: OperatorReportContext,
    ) {
      return send(
        "doorman operators summarized",
        operatorSummaryProperties(summary, context),
        validId(authenticatedId),
        context,
      );
    },
    captureOperatorProfile(
      profile: OperatorProfile,
      summary: OperatorSummary,
      authenticatedId: string,
      context: OperatorReportContext,
    ) {
      return send(
        "doorman operator profile",
        operatorProfileProperties(profile, summary, context),
        validId(authenticatedId),
        context,
      );
    },
    identifyUser(authenticatedId: string, traits: ProfileTraits = {}) {
      const userId = validId(authenticatedId);
      const properties: Properties = {};
      for (const key of ["name", "email", "plan"] as const) {
        const value = traits[key];
        if (value !== undefined) {
          if (typeof value !== "string" || value.length > 256)
            throw new Error("Invalid profile trait");
          properties[key] = value;
        }
      }
      return safe(() => {
        if (options.provider === "posthog")
          return options.client.identify({ distinctId: userId, properties });
        if (
          options.provider === "segment" ||
          options.provider === "rudderstack"
        )
          return options.client.identify({ userId, traits: properties });
        if (options.provider === "amplitude")
          return options.client.track({
            event_type: "$identify",
            user_id: userId,
            user_properties: { $set: properties },
            insert_id: crypto.randomUUID(),
            ip: "0.0.0.0",
          });
        if (options.provider !== "mixpanel")
          throw new Error("Unknown analytics provider");
        const profile = Object.fromEntries(
          Object.entries(properties).map(([k, v]) => [
            k === "name" || k === "email" ? `$${k}` : k,
            v,
          ]),
        );
        return options.client.people.set(userId, { ...profile, ip: "0" });
      });
    },
  };
}
