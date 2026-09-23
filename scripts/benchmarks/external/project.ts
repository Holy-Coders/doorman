import { resolve } from "node:path";
import { replayBehavior } from "./behavior.js";
import type { ReplayEvent } from "./behavior.js";
import { ndjson, privateJson } from "./io.js";

export type BehaviorRow = {
  id: string;
  group: string;
  browserLink?: string;
  family?: string;
  environment?: string;
  partition?: string;
  positive: boolean;
  events: ReplayEvent[];
};
export async function projectBehavior(
  source: "fpagent" | "balabit",
  directory: string,
) {
  const rows = [];
  const counts: Record<
    string,
    { sessions: number; features: Record<string, number> }
  > = {};
  for await (const row of ndjson<BehaviorRow>(
    resolve(directory, `${source}.ndjson`),
  )) {
    const features = replayBehavior(row.events);
    rows.push({
      id: row.id,
      group: row.group,
      browserLink: row.browserLink,
      family: row.family,
      environment: row.environment,
      partition: row.partition,
      positive: row.positive,
      features,
    });
    const count = (counts[row.family ?? row.partition ?? "unknown"] ??= {
      sessions: 0,
      features: {},
    });
    count.sessions++;
    for (const key of Object.keys(features))
      count.features[key] = (count.features[key] ?? 0) + 1;
  }
  await privateJson(resolve(directory, `${source}-features.json`), {
    source,
    rows,
  });
  return counts;
}
