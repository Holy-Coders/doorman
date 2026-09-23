import type { VisitorIdentity } from "@janitor/core";

/** Pass to your existing SDK. Never export debug payloads or inferred account IDs. */
export function analyticsProperties(identity: VisitorIdentity) {
  return Object.fromEntries(
    Object.entries({
      janitor_visitor_id: identity.visitorId,
      janitor_confidence: identity.confidence,
      janitor_returning: identity.isReturning,
      janitor_automation: identity.risk.automation,
      janitor_suspicious: identity.risk.suspicious,
      janitor_risk_status: identity.riskStatus,
      janitor_actor_kind: identity.attribution?.actor.kind,
      janitor_delegation_status: identity.attribution?.delegation.status,
    }).filter(([, v]) => v !== undefined),
  );
}
export type ProfileTraits = { name?: string; email?: string; plan?: string };
type Properties = Record<string, unknown>;
type BridgeOptions =
  | {
      provider: "posthog";
      client: {
        capture(event: {
          distinctId: string;
          event: string;
          properties: Properties;
        }): unknown;
        identify(event: {
          distinctId: string;
          properties: Properties;
        }): unknown;
      };
    }
  | {
      provider: "mixpanel";
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
  const id = (value: string) => {
    if (!value?.trim() || value.length > 512)
      throw new Error("Authenticated analytics ID required");
    return value;
  };
  const safe = async (send: () => unknown) => {
    try {
      await send();
      return { status: "queued" as const };
    } catch {
      return { status: "unavailable" as const };
    }
  };
  return {
    capture(identity: VisitorIdentity, authenticatedId: string) {
      const userId = id(authenticatedId);
      const properties = analyticsProperties(identity);
      const event = "janitor identified";
      return safe(() => {
        if (options.provider === "posthog")
          return options.client.capture({
            distinctId: userId,
            event,
            properties: { ...properties, $geoip_disable: true },
          });
        if (options.provider === "segment")
          return options.client.track({ userId, event, properties });
        return options.client.track(event, {
          ...properties,
          distinct_id: userId,
          ip: 0,
        });
      });
    },
    identifyUser(authenticatedId: string, traits: ProfileTraits = {}) {
      const userId = id(authenticatedId);
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
