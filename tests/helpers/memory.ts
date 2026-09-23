import { createVisitorId } from "@janitor/core";
import type {
  ManagedVisitorStorage,
  NormalizedObservation,
} from "@janitor/core";

export function createMemoryStorage(): ManagedVisitorStorage & {
  rows: Map<
    string,
    { lastSeenAt: number; observations: NormalizedObservation[] }
  >;
} {
  const rows = new Map<
    string,
    { lastSeenAt: number; observations: NormalizedObservation[] }
  >();
  return {
    rows,
    async createVisitor() {
      const id = createVisitorId();
      rows.set(id, { lastSeenAt: Date.now(), observations: [] });
      return id;
    },
    async findCandidates(_observation, limit) {
      return [...rows]
        .sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)
        .slice(0, limit)
        .map(([visitorId, row]) => ({ visitorId, lastSeenAt: row.lastSeenAt }));
    },
    async getRecentObservations(id, limit) {
      return rows.get(id)?.observations.slice(-limit).reverse() ?? [];
    },
    async saveObservation(id, observation) {
      const row = rows.get(id);
      if (!row) throw new Error("Unknown visitor");
      row.observations.push(structuredClone(observation));
    },
    async touchVisitor(id) {
      const row = rows.get(id);
      if (!row) throw new Error("Unknown visitor");
      row.lastSeenAt = Date.now();
    },
    async cleanup() {},
    async deleteVisitor(id) {
      rows.delete(id);
    },
  };
}
