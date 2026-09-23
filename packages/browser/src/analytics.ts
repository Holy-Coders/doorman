type Profile = { name?: string; email?: string; plan?: string };
type Status = "queued" | "unavailable" | "skipped";
type Provider = "posthog" | "mixpanel";
type Result = Partial<Record<Provider, Status>>;

/** Browser SDK lifecycle only. Private Janitor results never enter this bridge. */
export function createIdentityAnalytics(options: {
  visitor?: { reset(): void };
  posthog?: {
    identify(id: string, properties?: Record<string, string>): unknown;
    reset(): unknown;
  };
  mixpanel?: {
    identify(id: string): unknown;
    track(event: string, properties?: Record<string, unknown>): unknown;
    reset(): unknown;
    people: { set(properties: Record<string, string>): unknown };
  };
}) {
  // One instance per app lifecycle. Providers retain their own anonymous IDs.
  const previous: Partial<Record<Provider, string>> = {};
  const profiles: Partial<Record<Provider, string>> = {};
  const needsReset = new Set<Provider>();
  let userId: string | undefined;
  const resetVisitor = () => {
    try {
      options.visitor?.reset();
    } catch {
      /* Never interrupt authentication. */
    }
  };
  return {
    identifyUser(id: string, traits: Profile = {}): Result {
      if (
        typeof id !== "string" ||
        !id.trim() ||
        id.length > 512 ||
        /^vis_[a-f0-9]{48}$/.test(id)
      )
        throw new Error("Use the authenticated user's stable application ID");
      const profile: Record<string, string> = {};
      for (const key of ["name", "email", "plan"] as const) {
        const value = traits[key];
        if (value !== undefined) {
          if (typeof value !== "string" || value.length > 256)
            throw new Error("Invalid profile trait");
          profile[key] = value;
        }
      }
      if (userId !== id) resetVisitor();
      userId = id;
      const signature = JSON.stringify(profile);
      const result: Result = {};
      for (const provider of ["posthog", "mixpanel"] as const) {
        const client = options[provider];
        if (!client) continue;
        try {
          if (
            needsReset.has(provider) ||
            (previous[provider] && previous[provider] !== id)
          ) {
            client.reset();
            delete previous[provider];
            delete profiles[provider];
            needsReset.delete(provider);
          }
          if (previous[provider] === id && profiles[provider] === signature) {
            result[provider] = "skipped";
            continue;
          }
          if (provider === "posthog") options.posthog!.identify(id, profile);
          else {
            if (previous.mixpanel !== id) {
              options.mixpanel!.identify(id);
              // Simplified ID Merge needs an event after identify to join device and user IDs.
              options.mixpanel!.track("janitor user identified");
            }
            if (Object.keys(profile).length)
              options.mixpanel!.people.set(
                Object.fromEntries(
                  Object.entries(profile).map(([key, value]) => [
                    key === "plan" ? key : `$${key}`,
                    value,
                  ]),
                ),
              );
          }
          previous[provider] = id;
          profiles[provider] = signature;
          result[provider] = "queued";
        } catch {
          // A partially completed SDK call may have changed its current user.
          needsReset.add(provider);
          result[provider] = "unavailable";
        }
      }
      return result;
    },
    reset(): Result {
      resetVisitor();
      userId = undefined;
      const result: Result = {};
      for (const provider of ["posthog", "mixpanel"] as const) {
        const client = options[provider];
        if (!client) continue;
        needsReset.add(provider);
        try {
          client.reset();
          delete previous[provider];
          delete profiles[provider];
          needsReset.delete(provider);
          result[provider] = "queued";
        } catch {
          result[provider] = "unavailable";
        }
      }
      return result;
    },
  };
}
