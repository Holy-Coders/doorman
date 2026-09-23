import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { z } from "zod";
import {
  read,
  writePrivate,
  trainClassifier,
  enrichDataset,
} from "./classifier/operations.js";
import { classifierFixture } from "./classifier/fixture.js";
import { validateClassifierDataset } from "../packages/network/src/classifier-data.js";
import { classifierSplitSchema } from "../packages/network/src/classifier-schema.js";
import { validateClassifierReport } from "../packages/network/src/classifier-evaluation.js";
import {
  createClassifierJevEvaluator,
  CLASSIFIER_JEV_MODEL,
} from "../packages/network/src/classifier-jev.js";
import { readJSON, validateEndpoint } from "../packages/network/src/http.js";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    dataset: { type: "string" },
    features: { type: "string" },
    split: { type: "string" },
    model: { type: "string" },
    config: { type: "string" },
    "max-calls": { type: "string" },
    live: { type: "boolean", default: false },
    percent: { type: "string" },
  },
});
const command = positionals[0],
  directory = resolve(values.out ?? "artifacts/classifier");
const required = (key: "dataset" | "split" | "model") => {
  const value = values[key];
  if (!value) throw new Error(`Set --${key}`);
  return value;
};
async function operator(path: string, body: unknown) {
  const config = values.config
    ? z
        .object({ endpoint: z.string(), operatorToken: z.string() })
        .parse(await read(values.config))
    : {
        endpoint: process.env.DOORMAN_NETWORK_ENDPOINT ?? "",
        operatorToken: process.env.DOORMAN_OPERATOR_TOKEN ?? "",
      };
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(config.operatorToken))
    throw new Error(
      "Set operator credentials in environment or --config private.json",
    );
  const response = await fetch(
    validateEndpoint(config.endpoint) + "/operator/classifier/" + path,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.operatorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Operator rejected action (${response.status})`);
  }
  return readJSON(response.body, 16 * 1024 * 1024, 30000);
}
try {
  if (command === "demo") {
    const { dataset, enrichment } = await classifierFixture();
    await writePrivate(resolve(directory, "dataset.json"), dataset);
    await writePrivate(resolve(directory, "features.json"), enrichment);
    const result = await trainClassifier(dataset, enrichment);
    await writePrivate(resolve(directory, "model.json"), result.model);
    console.log(
      JSON.stringify(
        {
          origin: "synthetic",
          rows: dataset.rows.length,
          candidates: result.model.comparison.map((c) => c.name),
          selected: result.model.selected.name,
          holdout: result.model.metrics.holdout,
          eligible: result.model.eligible,
          paidCalls: 0,
          output: directory,
        },
        null,
        2,
      ),
    );
  } else if (command === "export") {
    const data = await operator(
      "export",
      classifierSplitSchema.parse(await read(required("split"))),
    );
    const parsed = await validateClassifierDataset(data);
    await writePrivate(resolve(directory, "dataset.json"), parsed);
    console.log(
      JSON.stringify({
        rows: parsed.manifest.rows,
        partitions: parsed.manifest.partitions,
        output: directory,
      }),
    );
  } else if (command === "enrich") {
    const dataset = await validateClassifierDataset(
      await read(required("dataset")),
    );
    const maximum = Number(values["max-calls"] ?? 0);
    if (maximum > 0 && !values.live)
      throw new Error(
        "Paid enrichment requires --live and an explicit --max-calls cumulative budget",
      );
    const evaluator =
      maximum > 0
        ? createClassifierJevEvaluator({
            apiKey: process.env.JEV_API_KEY ?? "",
          })
        : async () => {
            throw new Error("No inference budget");
          };
    console.log(
      JSON.stringify(
        await enrichDataset(
          dataset,
          resolve(directory, "features.json"),
          CLASSIFIER_JEV_MODEL,
          maximum,
          evaluator,
        ),
      ),
    );
  } else if (command === "train") {
    const data = await read(required("dataset"));
    const result = await trainClassifier(
      data,
      values.features ? await read(values.features) : undefined,
    );
    await writePrivate(resolve(directory, "model.json"), result.model);
    console.log(
      JSON.stringify({
        selected: result.model.selected.name,
        eligible: result.model.eligible,
        gates: result.model.gates,
        output: directory,
      }),
    );
  } else if (command === "stage") {
    const model = validateClassifierReport(await read(required("model"))),
      dataset = await validateClassifierDataset(
        await read(required("dataset")),
      );
    if (model.manifest.digest !== dataset.manifest.digest || !dataset.seal)
      throw new Error("Use the matching sealed operator export");
    console.log(
      JSON.stringify(await operator("stage", { model, seal: dataset.seal })),
    );
  } else if (command === "promote" || command === "rollback") {
    const model = validateClassifierReport(await read(required("model")));
    console.log(
      JSON.stringify(
        await operator(command, {
          modelId: model.id,
          ...(command === "promote"
            ? { canaryPercent: Number(values.percent ?? 1) }
            : {}),
        }),
      ),
    );
  } else
    throw new Error(
      "Usage: pnpm classifier demo|export|enrich|train|stage|promote|rollback (see docs/CLASSIFIER.md)",
    );
} catch (error) {
  // Native trainer errors can contain local data paths; print only the actionable message.
  console.error(
    error instanceof Error && "stderr" in error
      ? "Trainer failed. Check Python dependencies, partition support and calibration; no model was staged."
      : error instanceof Error
        ? error.message
        : "Classifier operation failed",
  );
  process.exitCode = 1;
}
