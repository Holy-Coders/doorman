import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SOURCES, sourceNames } from "./sources.js";
import { digest, privateJson } from "./io.js";
import { identityBenchmark } from "./identity.js";
import { projectBehavior } from "./project.js";
import { scoreClassifier } from "../../../packages/network/src/classifier.js";
import { classifierCandidateSchema } from "../../../packages/network/src/classifier-schema.js";
import type { FeatureVector } from "../../../packages/network/src/schema.js";

const execute = promisify(execFile);
const extended = process.argv.includes("--extended");
const suffix = extended ? "-extended" : "";
const directory = resolve("artifacts/external");
const python =
  process.env.CLASSIFIER_PYTHON ?? resolve("tools/classifier/.venv/bin/python");
const revision = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
const dirty = !!(await execute("git", ["status", "--porcelain"])).stdout.trim();
for (const source of sourceNames(process.argv[2])) {
  for (const file of SOURCES[source].files)
    if ((await digest(resolve(directory, file.name))) !== file.sha256)
      throw new Error(
        `Unverified research input: ${file.name}. Run benchmark:external:download first.`,
      );
  console.log(`Preparing ${source}`);
  await execute(
    python,
    ["tools/benchmarks/prepare.py", source, "--directory", directory],
    { maxBuffer: 1_000_000 },
  );
  let report: unknown;
  let coverage: unknown;
  let parityChecked = 0;
  if (source === "fpstalker")
    report = await identityBenchmark(resolve(directory, "fpstalker.ndjson"));
  else {
    coverage = await projectBehavior(source, directory);
    await execute(
      python,
      [
        "tools/benchmarks/evaluate.py",
        source,
        "--directory",
        directory,
        ...(extended ? ["--extended"] : []),
      ],
      { maxBuffer: 1_000_000 },
    );
    report = JSON.parse(
      await readFile(
        resolve(directory, `${source}${suffix}-report.json`),
        "utf8",
      ),
    );
    if (source === "fpagent") {
      const { rows } = JSON.parse(
        await readFile(resolve(directory, "fpagent-features.json"), "utf8"),
      ) as { rows: { features: FeatureVector }[] };
      const models = JSON.parse(
        await readFile(
          resolve(directory, `fpagent${suffix}-parity.json`),
          "utf8",
        ),
      ) as { candidate: unknown; scores: (number | null)[] }[];
      for (const model of models) {
        const candidate = classifierCandidateSchema.parse(model.candidate);
        if (model.scores.length !== rows.length)
          throw new Error("Parity row mismatch");
        rows.forEach((row, i) => {
          const actual = scoreClassifier(candidate, row.features),
            expected = model.scores[i]!;
          if (
            actual === null || expected === null
              ? actual !== expected
              : Math.abs(actual - expected) > 1e-7
          )
            throw new Error(
              "Python / production TypeScript prediction mismatch",
            );
          parityChecked++;
        });
      }
    }
  }
  const output = {
    version: 1,
    featureSet: extended ? "behavior-v2" : "behavior-v1",
    generatedAt: new Date().toISOString(),
    revision,
    worktreeModified: dirty,
    provenance: SOURCES[source],
    jevCalls: 0,
    productionPromoted: false,
    parityChecked,
    coverage,
    result: report,
  };
  await privateJson(
    resolve(directory, `${source}${suffix}-aggregate.json`),
    output,
  );
  console.log(
    JSON.stringify({
      source,
      parityChecked,
      report: `artifacts/external/${source}${suffix}-aggregate.json`,
    }),
  );
}
