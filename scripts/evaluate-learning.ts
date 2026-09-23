import { readFile, writeFile } from "node:fs/promises";
import {
  calculateSimilarity,
  evaluateLearning,
  type FeedbackExport,
} from "@aarondovturkel/doorman-core";
const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw new Error("Usage: pnpm evaluate:learning feedback.json report.json");
const text = await readFile(source, "utf8");
if (text.length > 20_000_000) throw new Error("Dataset exceeds 20 MB");
const data = JSON.parse(text) as FeedbackExport;
const report = await evaluateLearning(data, {
  deviceHoldout: true,
  predict: async ({ current, examples }) => {
    const ranked = examples
      .map((e) => ({
        subjectId: e.subjectId,
        score: calculateSimilarity(current, e.observation).score,
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const runner = ranked.find((e) => e.subjectId !== best?.subjectId);
    return best &&
      best.score >= 0.9 &&
      (!runner || best.score - runner.score >= 0.03)
      ? best
      : {};
  },
});
await writeFile(
  output,
  JSON.stringify(
    { baseline: "deterministic; scores uncalibrated", ...report },
    null,
    2,
  ) + "\n",
);
console.log(
  `Wrote aggregate report for ${report.trials} labeled trials to ${output}`,
);
