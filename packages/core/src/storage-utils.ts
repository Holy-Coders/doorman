import type { RetentionOptions } from "./types.js";
export const DAY_MS = 86_400_000;
export function retentionOptions(options: RetentionOptions) {
  const observationRetentionDays = options.observationRetentionDays ?? 90;
  const maxObservationsPerVisitor = options.maxObservationsPerVisitor ?? 10;
  if (
    !Number.isInteger(observationRetentionDays) ||
    observationRetentionDays < 1 ||
    !Number.isInteger(maxObservationsPerVisitor) ||
    maxObservationsPerVisitor < 1 ||
    maxObservationsPerVisitor > 100
  )
    throw new Error("Invalid retention options");
  return { observationRetentionDays, maxObservationsPerVisitor };
}
export function createVisitorId(): string {
  return (
    "vis_" +
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export const isVisitorId = (id: string) => /^vis_[a-f0-9]{48}$/.test(id);
export const boundedLimit = (limit: number, max: number) =>
  Math.max(1, Math.min(max, Number.isFinite(limit) ? Math.floor(limit) : max));
