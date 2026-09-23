import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../artifacts/", import.meta.url));
mkdirSync(output, { recursive: true });
const dependencies = {};
for (const path of [
  "core",
  "browser",
  "storage/d1",
  "storage/postgres",
  "evaluators/jev",
  "evaluators/cloudflare-jev",
  "adapters",
]) {
  const manifest = JSON.parse(
    readFileSync(`${root}/packages/${path}/package.json`, "utf8"),
  );
  dependencies[manifest.name] =
    `file:./${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`;
  execFileSync("pnpm", ["pack", "--pack-destination", output], {
    cwd: `${root}/packages/${path}`,
    stdio: "inherit",
  });
}

writeFileSync(
  `${output}/package.json`,
  JSON.stringify(
    {
      name: "janitor-packed-consumer",
      private: true,
      type: "module",
      packageManager: "pnpm@9.12.0",
      dependencies,
      pnpm: { overrides: dependencies },
      overrides: dependencies,
    },
    null,
    2,
  ) + "\n",
);
