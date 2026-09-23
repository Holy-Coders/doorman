import { afterEach, expect, it, vi } from "vitest";
import { createServer, request, Agent, type Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { createNodeRequestListener } from "../packages/adapters/src/node/http.js";

const servers: Server[] = [];
const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) agent.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function start(handle: (r: Request) => Promise<Response>, options = {}) {
  const server = createServer(
    createNodeRequestListener(
      { handle },
      {
        origin: "http://localhost",
        maxInFlightRequests: 1,
        ...options,
      },
    ),
  );
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  return address.port;
}
function post(port: number, body = "{}", agent?: Agent) {
  return new Promise<{ status: number; body: string; cookies?: string[] }>(
    (resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/visitor",
          method: "POST",
          agent,
          headers: {
            "content-length": Buffer.byteLength(body),
            host: "spoofed.example",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => {
            data += c;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: data,
              cookies: res.headers["set-cookie"],
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    },
  );
}
it("rejects a burst before conversion or handler work and recovers on keep-alive sockets", async () => {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const handle = vi.fn(async (r: Request) => {
    expect(r.url).toBe("http://localhost/api/visitor");
    expect(await r.text()).toBe("{}");
    markStarted();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    const headers = new Headers();
    headers.append("set-cookie", "a=1; HttpOnly");
    headers.append("set-cookie", "b=2; Secure");
    return new Response("ok", { headers });
  });
  const port = await start(handle);
  const first = post(port);
  await started;
  const agent = new Agent({ keepAlive: true, maxSockets: 8 });
  agents.push(agent);
  const burst = await Promise.all(
    Array.from({ length: 128 }, () => post(port, "{}", agent)),
  );
  expect(burst.every((r) => r.status === 503)).toBe(true);
  expect(handle).toHaveBeenCalledOnce();
  release();
  expect((await first).cookies).toEqual(["a=1; HttpOnly", "b=2; Secure"]);
  handle.mockImplementation(async () => new Response("recovered"));
  expect((await post(port, "{}", agent)).status).toBe(200);
});
it("bounds bodies declared by length or streamed in chunks", async () => {
  const handle = vi.fn(async () => new Response("ok"));
  const port = await start(handle, { maxBodyBytes: 8 });
  expect((await post(port, "x".repeat(9))).status).toBe(413);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: "/api/visitor", method: "POST" },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      },
    );
    req.on("error", reject);
    req.write("12345");
    req.end("6789");
  });
  expect(status).toBe(413);
  expect(handle).not.toHaveBeenCalled();
  expect((await post(port)).status).toBe(200);
});
it("times out a stalled upload and releases admission without calling the handler", async () => {
  const handle = vi.fn(async () => new Response("ok"));
  const port = await start(handle, { requestTimeoutMs: 100 });
  const socket = connect(port, "127.0.0.1");
  let response = "";
  socket.on("data", (c) => {
    response += c;
  });
  socket.write(
    "POST /api/visitor HTTP/1.1\r\nHost: localhost\r\nContent-Length: 8\r\n\r\n{",
  );
  await once(socket, "close");
  expect(response).toContain("503");
  expect(handle).not.toHaveBeenCalled();
  expect((await post(port)).status).toBe(200);
});
it("holds timed-out work's slot until the handler actually settles", async () => {
  let release!: () => void;
  const handle = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response("late"));
      }),
  );
  const port = await start(handle, { requestTimeoutMs: 100 });
  expect((await post(port)).status).toBe(503);
  expect((await post(port)).status).toBe(503);
  expect(handle).toHaveBeenCalledOnce();
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  handle.mockImplementation(async () => new Response("ok"));
  expect((await post(port)).status).toBe(200);
});
it("cleans up an aborted upload", async () => {
  const port = await start(async () => new Response("ok"));
  const socket = connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.write(
    "POST /api/visitor HTTP/1.1\r\nHost: localhost\r\nContent-Length: 8\r\n\r\n{",
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  socket.destroy();
  await once(socket, "close");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await post(port)).status).toBe(200);
});
