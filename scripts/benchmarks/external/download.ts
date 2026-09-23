import { mkdir, stat, rename, rm, open } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { digest } from "./io.js";
import { SOURCES, sourceNames } from "./sources.js";

const directory = resolve("artifacts/external");
await mkdir(directory, { recursive: true, mode: 0o700 });
for (const name of sourceNames(process.argv[2])) {
  const source = SOURCES[name];
  for (const file of source.files) {
    const destination = resolve(directory, file.name);
    if (
      await stat(destination).then(
        () => true,
        () => false,
      )
    ) {
      if ((await digest(destination)) !== file.sha256)
        throw new Error(`Checksum mismatch: ${file.name}`);
      console.log(`Verified cached ${file.name}`);
      continue;
    }
    const url =
      "url" in file
        ? file.url
        : source.url.replace(
            "https://github.com/",
            "https://raw.githubusercontent.com/",
          ) + `/${source.revision}/${"path" in file ? file.path : file.name}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20 * 60_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Download failed for ${file.name}: ${response.status}`);
    const partial = `${destination}.partial`;
    let bytes = 0;
    const handle = await open(partial, "wx", 0o600);
    try {
      await pipeline(
        (async function* () {
          const reader = response.body!.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.length;
              if (bytes > file.bytes)
                throw new Error(`Download exceeds pinned size: ${file.name}`);
              yield value;
            }
          } finally {
            await reader.cancel();
          }
        })(),
        handle.createWriteStream(),
      );
      if ((await digest(partial)) !== file.sha256)
        throw new Error(`Checksum mismatch: ${file.name}`);
      await rename(partial, destination);
      console.log(`Downloaded and verified ${file.name} (${bytes} bytes)`);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }
}
