import type { IdentityAttribution, VisitorIdentity } from "@janitor/core";

/** An authenticated server agent can have attribution without a browser observation. */
export type AnalyticsAssessment =
  VisitorIdentity | { attribution: IdentityAttribution };

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
  return Object.fromEntries(
    Object.entries({
      janitor_schema_version: 1,
      janitor_account_id:
        context.accountId === undefined
          ? undefined
          : validId(context.accountId),
      janitor_subject_id:
        subject?.status === "verified" ? subject.id : undefined,
      janitor_subject_status: subject?.status ?? "unknown",
      janitor_actor_id: verifiedActor ? actor.id : undefined,
      janitor_actor_basis: verifiedActor ? "verified-credential" : "unknown",
      janitor_visitor_id: browser?.visitorId,
      janitor_confidence: browser?.confidence,
      janitor_returning: browser?.isReturning,
      janitor_automation: browser?.risk.automation,
      janitor_suspicious: browser?.risk.suspicious,
      janitor_risk_status: browser?.riskStatus,
      janitor_actor_kind: verifiedActor ? actor.kind : "unknown",
      janitor_delegation_status: identity.attribution?.delegation.status,
    }).filter(([, v]) => v !== undefined),
  );
}
export type ProfileTraits = { name?: string; email?: string; plan?: string };
type Properties = Record<string, unknown>;
type BridgeOptions =
  | {
      provider: "posthog";
      /** Optional provider group type; janitor_account_id is always an event property. */
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
      provider: "segment";
      client: {
        track(event: {
          userId: string;
          event: string;
          properties: Properties;
        }): unknown;
        identify(event: { userId: string; traits: Properties }): unknown;
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
      (group.startsWith("janitor_") && group !== "janitor_account_id"))
  )
    throw new Error("Invalid analytics account group");
  const safe = async (send: () => unknown) => {
    try {
      await send();
      return { status: "queued" as const };
    } catch {
      return { status: "unavailable" as const };
    }
  };
  return {
    capture(
      identity: AnalyticsAssessment,
      authenticatedId: string,
      context: AnalyticsContext = {},
    ) {
      const userId = validId(authenticatedId);
      const properties = analyticsProperties(identity, context);
      const event = "janitor identified";
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
        if (options.provider === "segment")
          return options.client.track({ userId, event, properties });
        return options.client.track(event, {
          ...properties,
          distinct_id: userId,
          ...(options.identityMerge !== "original" ? { $user_id: userId } : {}),
          ...(group && context.accountId ? { [group]: context.accountId } : {}),
          ip: 0,
        });
      });
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
        if (options.provider === "segment")
          return options.client.identify({ userId, traits: properties });
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
