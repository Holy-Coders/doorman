import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

export async function* ndjson<T>(path: string): AsyncGenerator<T> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines)
      if (line.trim()) yield JSON.parse(line) as T;
  } finally {
    lines.close();
    stream.destroy();
  }
}
export async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}
export async function privateJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}
