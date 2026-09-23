export class NetworkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readJSON(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = 16_384,
  timeoutMs = 1500,
): Promise<unknown> {
  if (!body) throw new NetworkError(400, "JSON body required");
  const reader = body.getReader();
  let size = 0,
    text = "",
    timer: ReturnType<typeof setTimeout> | undefined;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new NetworkError(408, "Read timed out"));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new NetworkError(413, "Body too large");
      text += decoder.decode(value, { stream: true });
    }
    try {
      return JSON.parse(text + decoder.decode());
    } catch {
      throw new NetworkError(400, "Invalid JSON");
    }
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(400, "Invalid JSON");
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export const newId = (prefix: string) =>
  prefix + "_" + crypto.randomUUID().replaceAll("-", "");
export function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error(
      "Use HTTPS, or loopback HTTP, without credentials/query/fragment",
    );
  return url.href.replace(/\/$/, "");
}
