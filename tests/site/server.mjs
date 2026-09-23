import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../site/dist/", import.meta.url));
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain",
};
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1:4357");
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(
      root,
      "." + pathname + (pathname.endsWith("/") ? "index.html" : ""),
    );
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep))
      throw new Error("Invalid path");
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/html" });
    response.end(
      await readFile(resolve(root, "404.html")).catch(() => "Not found"),
    );
  }
}).listen(4357, "127.0.0.1");
