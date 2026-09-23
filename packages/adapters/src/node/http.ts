import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from "node:http";

export type NodeRequestListenerOptions = {
  /** The application's configured origin. Never derive this from an untrusted Host header. */
  origin: string;
  maxInFlightRequests?: number;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  onOverload?: () => void;
  onResponse?: (status: number) => void;
};

const OVERLOADED = '{"error":"Visitor service busy"}';

/** Admit before allocating Web Requests, streams, body buffers or handler promises. */
export function createNodeRequestListener(
  visitor: { handle(request: Request): Promise<Response> },
  options: NodeRequestListenerOptions,
): RequestListener {
  const origin = new URL(options.origin);
  if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password)
    throw new Error("Invalid application origin");
  const bounded = (value: number, min: number, max: number) => {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error("Invalid Node listener limit");
    return value;
  };
  const maximum = bounded(options.maxInFlightRequests ?? 64, 1, 1024);
  const bodyLimit = bounded(options.maxBodyBytes ?? 16_384, 1, 65_536);
  const timeout = bounded(options.requestTimeoutMs ?? 5000, 100, 30_000);
  let active = 0;
  const notify = (fn: (() => void) | undefined) => {
    try {
      fn?.();
    } catch {
      /* Instrumentation must not break admission. */
    }
  };
  const reply = (res: ServerResponse, status: number, body: string) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      ...(status === 503 ? { "retry-after": "1" } : {}),
    });
    res.end(body);
    notify(() => options.onResponse?.(status));
  };
  const reject = (
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
  ) => {
    // Keep known, bounded bodies reusable. Do not drain an unbounded chunked upload.
    const length = req.headers["content-length"];
    if (
      req.headers["transfer-encoding"] ||
      (length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) > bodyLimit))
    )
      res.setHeader("connection", "close");
    req.resume();
    reply(
      res,
      status,
      status === 503 ? OVERLOADED : '{"error":"Invalid request"}',
    );
  };
  return (req, res) => {
    if (active >= maximum) {
      notify(options.onOverload);
      reject(req, res, 503);
      return;
    }
    const length = req.headers["content-length"];
    if (
      length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) > bodyLimit)
    ) {
      reject(req, res, 413);
      return;
    }
    // Only origin-form paths are accepted, preventing absolute URL / Host spoofing.
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
      reject(req, res, 400);
      return;
    }
    active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.on("close", abort);
    const timer = setTimeout(() => {
      res.setHeader("connection", "close");
      reply(res, 503, OVERLOADED);
      controller.abort();
    }, timeout);
    timer.unref();
    const run = async () => {
      try {
        const body = await readBody(req, bodyLimit, controller.signal);
        if (controller.signal.aborted) return;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const method = req.method ?? "GET";
        const request = new Request(origin.origin + req.url, {
          method,
          headers,
          signal: controller.signal,
          ...(method === "GET" || method === "HEAD"
            ? {}
            : { body: new Uint8Array(body) }),
        });
        const response = await visitor.handle(request);
        if (controller.signal.aborted || res.destroyed || res.writableEnded)
          return;
        const payload = Buffer.from(await response.arrayBuffer());
        if (controller.signal.aborted || res.destroyed || res.writableEnded)
          return;
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie") res.setHeader(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("set-cookie", cookies);
        res.setHeader("content-length", payload.length);
        res.writeHead(response.status);
        res.end(payload);
        notify(() => options.onResponse?.(response.status));
      } catch (error) {
        if (!controller.signal.aborted) {
          res.setHeader("connection", "close");
          reply(
            res,
            error instanceof BodyTooLarge ? 413 : 500,
            '{"error":"Visitor request failed"}',
          );
        }
      } finally {
        clearTimeout(timer);
        res.off("close", abort);
        // A disconnected request retains its slot until its actual work settles.
        active--;
      }
    };
    void run();
  };
}

class BodyTooLarge extends Error {}
function readBody(
  req: IncomingMessage,
  maximum: number,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const clean = () => {
      req.off("data", data);
      req.off("end", end);
      req.off("error", fail);
      req.off("aborted", abort);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      clean();
      req.resume();
      reject(error);
    };
    const abort = () => fail(new Error("Request aborted"));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) fail(new BodyTooLarge());
      else chunks.push(chunk);
    };
    const end = () => {
      clean();
      resolve(Buffer.concat(chunks, size));
    };
    req.on("data", data);
    req.once("end", end);
    req.once("error", fail);
    req.once("aborted", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
