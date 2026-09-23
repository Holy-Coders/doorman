export type Profile = { name?: string; email?: string; plan?: string };
type Status = "queued" | "unavailable" | "skipped";
type Provider = "posthog" | "mixpanel" | "segment";
export type AnalyticsResult = Partial<Record<Provider, Status>>;

/** Browser SDK lifecycle only. Private Janitor results never enter this bridge. */
export type IdentityAnalyticsOptions = {
  visitor?: { reset(): void };
  posthog?: {
    identify(id: string, properties?: Record<string, string>): unknown;
    reset(): unknown;
    capture?(event: string, properties?: Record<string, unknown>): unknown;
  };
  mixpanel?: {
    identify(id: string): unknown;
    track(event: string, properties?: Record<string, unknown>): unknown;
    reset(): unknown;
    people: { set(properties: Record<string, string>): unknown };
  };
  segment?: {
    identify(id: string, traits?: Record<string, string>): unknown;
    track(event: string, properties?: Record<string, unknown>): unknown;
    reset(): unknown;
  };
};
export function createIdentityAnalytics(options: IdentityAnalyticsOptions) {
  // One instance per app lifecycle. Providers retain their own anonymous IDs.
  const previous: Partial<Record<Provider, string>> = {};
  const profiles: Partial<Record<Provider, string>> = {};
  const needsReset = new Set<Provider>();
  let userId: string | undefined;
  let generation = 0;
  const resetVisitor = () => {
    try {
      options.visitor?.reset();
    } catch {
      /* Never interrupt authentication. */
    }
  };
  let segmentQueue: Promise<void> = Promise.resolve();
  const queueSegment = (run: () => Promise<void>) => {
    segmentQueue = segmentQueue.then(run).catch(() => {
      needsReset.add("segment");
    });
  };
  return {
    identifyUser(id: string, traits: Profile = {}): AnalyticsResult {
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
      if (userId !== id) {
        generation++;
        resetVisitor();
      }
      userId = id;
      const signature = JSON.stringify(profile);
      const result: AnalyticsResult = {};
      for (const provider of ["posthog", "mixpanel", "segment"] as const) {
        const client = options[provider];
        if (!client) continue;
        if (provider === "segment") {
          queueSegment(async () => {
            if (
              needsReset.has("segment") ||
              (previous.segment && previous.segment !== id)
            ) {
              await options.segment!.reset();
              delete previous.segment;
              delete profiles.segment;
              needsReset.delete("segment");
            }
            if (previous.segment === id && profiles.segment === signature)
              return;
            await options.segment!.identify(id, profile);
            previous.segment = id;
            profiles.segment = signature;
          });
          result.segment = "queued";
          continue;
        }
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
    flush: () => segmentQueue,
    async track(
      event: string,
      properties: Record<string, unknown> = {},
    ): Promise<AnalyticsResult> {
      const current = generation;
      await segmentQueue;
      const result: AnalyticsResult = {};
      for (const provider of ["posthog", "mixpanel", "segment"] as const) {
        const client = options[provider];
        if (!client) continue;
        if (current !== generation) {
          result[provider] = "skipped";
          continue;
        }
        if (needsReset.has(provider)) {
          result[provider] = "unavailable";
          continue;
        }
        try {
          if (provider === "posthog") {
            if (!options.posthog!.capture) {
              result[provider] = "skipped";
              continue;
            }
            await options.posthog!.capture(event, properties);
          } else if (provider === "mixpanel")
            await options.mixpanel!.track(event, properties);
          else await options.segment!.track(event, properties);
          result[provider] = "queued";
        } catch {
          result[provider] = "unavailable";
        }
      }
      return result;
    },
    reset(): AnalyticsResult {
      generation++;
      resetVisitor();
      userId = undefined;
      const result: AnalyticsResult = {};
      for (const provider of ["posthog", "mixpanel", "segment"] as const) {
        const client = options[provider];
        if (!client) continue;
        if (provider === "segment") {
          queueSegment(async () => {
            needsReset.add("segment");
            await options.segment!.reset();
            delete previous.segment;
            delete profiles.segment;
            needsReset.delete("segment");
          });
          result.segment = "queued";
          continue;
        }
        needsReset.add(provider);
        try {
          const reset = client.reset();
          if (
            reset &&
            typeof (reset as PromiseLike<unknown>).then === "function"
          )
            void Promise.resolve(reset).catch(() => {
              needsReset.add(provider);
            });
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
