type AnalyticsProperties = Record<string, string | number | boolean | null>;
export type Profile = { name?: string; email?: string; plan?: string };
type Status = "queued" | "unavailable" | "skipped";
type Provider =
  "posthog" | "mixpanel" | "segment" | "amplitude" | "rudderstack";
const providers = [
  "posthog",
  "mixpanel",
  "segment",
  "amplitude",
  "rudderstack",
] as const;
export type AnalyticsResult = Partial<Record<Provider, Status>>;

/** Browser SDK lifecycle only. Private Janitor results never enter this bridge. */
export type IdentityAnalyticsOptions = {
  visitor?: { reset(): void };
  posthog?: {
    identify(id: string, properties?: Record<string, string>): unknown;
    reset(): unknown;
    capture?(event: string, properties?: AnalyticsProperties): unknown;
  };
  mixpanel?: {
    identify(id: string): unknown;
    track(event: string, properties?: AnalyticsProperties): unknown;
    reset(): unknown;
    people: { set(properties: Record<string, string>): unknown };
  };
  segment?: {
    identify(id: string, traits?: Record<string, string>): unknown;
    track(event: string, properties?: AnalyticsProperties): unknown;
    reset(): unknown;
  };
  /** Pass the initialized @amplitude/analytics-browser module or instance. */
  amplitude?: {
    setUserId(id: string): unknown;
    reset(): unknown;
    track(
      event:
        | string
        | { event_type: string; user_properties: Record<string, unknown> },
      properties?: AnalyticsProperties,
    ): unknown;
  };
  rudderstack?: {
    identify(id: string, traits?: Record<string, string>): unknown;
    track(event: string, properties?: AnalyticsProperties): unknown;
    reset(options: {
      entries: {
        anonymousId: true;
        initialReferrer: true;
        initialReferringDomain: true;
      };
    }): unknown;
    clearCustomContext?(): unknown;
  };
};
export function createIdentityAnalytics(options: IdentityAnalyticsOptions) {
  // Normalize the two concrete provider protocols without bundling their SDKs.
  const clients = {
    ...options,
    amplitude: options.amplitude && {
      identify(id: string, profile: Record<string, string> = {}) {
        options.amplitude!.setUserId(id);
        // HTTP V2's documented identify event; the SDK supplies device/session context.
        return options.amplitude!.track({
          event_type: "$identify",
          user_properties: { $set: profile },
        });
      },
      reset: () => options.amplitude!.reset(),
      track: (event: string, properties: AnalyticsProperties) =>
        options.amplitude!.track(event, properties),
    },
    rudderstack: options.rudderstack && {
      identify: (id: string, traits: Record<string, string> = {}) =>
        options.rudderstack!.identify(id, traits),
      track: (event: string, properties: AnalyticsProperties) =>
        options.rudderstack!.track(event, properties),
      reset() {
        options.rudderstack!.clearCustomContext?.();
        return options.rudderstack!.reset({
          entries: {
            anonymousId: true,
            initialReferrer: true,
            initialReferringDomain: true,
          },
        });
      },
    },
  };
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
  let providerQueue: Promise<void> = Promise.resolve();
  const queueProvider = (provider: Provider, run: () => Promise<void>) => {
    providerQueue = providerQueue.then(run).catch(() => {
      needsReset.add(provider);
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
      for (const provider of providers) {
        const client = clients[provider];
        if (!client) continue;
        if (
          provider === "segment" ||
          provider === "amplitude" ||
          provider === "rudderstack"
        ) {
          queueProvider(provider, async () => {
            if (
              needsReset.has(provider) ||
              (previous[provider] && previous[provider] !== id)
            ) {
              await sdkResult(client.reset());
              delete previous[provider];
              delete profiles[provider];
              needsReset.delete(provider);
            }
            if (previous[provider] === id && profiles[provider] === signature)
              return;
            await sdkResult(client.identify(id, profile));
            previous[provider] = id;
            profiles[provider] = signature;
          });
          result[provider] = "queued";
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
    flush: () => providerQueue,
    async track(
      event: string,
      properties: AnalyticsProperties = {},
    ): Promise<AnalyticsResult> {
      const current = generation;
      await providerQueue;
      const result: AnalyticsResult = {};
      for (const provider of providers) {
        const client = clients[provider];
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
          else await sdkResult(clients[provider]!.track(event, properties));
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
      for (const provider of providers) {
        const client = clients[provider];
        if (!client) continue;
        if (
          provider === "segment" ||
          provider === "amplitude" ||
          provider === "rudderstack"
        ) {
          queueProvider(provider, async () => {
            needsReset.add(provider);
            await sdkResult(client.reset());
            delete previous[provider];
            delete profiles[provider];
            needsReset.delete(provider);
          });
          result[provider] = "queued";
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

async function sdkResult(value: unknown): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending =
    value && typeof value === "object" && "promise" in value
      ? value.promise
      : value;
  const result = await Promise.race([
    Promise.resolve(pending),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Analytics SDK timed out")),
        1000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    result &&
    typeof result === "object" &&
    "code" in result &&
    typeof result.code === "number" &&
    result.code >= 300
  )
    throw new Error("Analytics SDK rejected event");
}
