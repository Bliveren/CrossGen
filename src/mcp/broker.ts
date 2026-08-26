import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { PassThrough, type Readable, type Writable } from "node:stream";

export interface McpBrokerSessionOptions {
  input: Readable;
  output: Writable;
  mode: string;
  idleTimeoutMs: number;
}

export interface McpBrokerOptions {
  socketPath: string;
  mode: string;
  idleTimeoutMs: number;
  input: Readable;
  output: Writable;
  runSession: (options: McpBrokerSessionOptions) => Promise<number>;
}

const CONNECT_TIMEOUT_MS = 350;
const MAX_HANDSHAKE_BYTES = 4096;

export function socketPathForUserData(userDataDir: string): string {
  const candidate = `${userDataDir}/.crossgen-mcp.sock`;
  // macOS limits Unix-domain socket paths to roughly 104 bytes.
  if (Buffer.byteLength(candidate) <= 100) return candidate;
  const digest = createHash("sha256").update(userDataDir).digest("hex").slice(0, 20);
  return `/tmp/crossgen-mcp-${digest}.sock`;
}

function removeSocket(socketPath: string): Promise<void> {
  return fs.unlink(socketPath).catch(() => undefined);
}

async function connectExisting(socketPath: string, mode: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (result: Socket | null): void => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      if (result) resolve(result);
      else {
        socket.destroy();
        resolve(null);
      }
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(null));
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ crossgenMcpBroker: 1, mode })}\n`);
      finish(socket);
    });
    socket.once("error", () => finish(null));
  });
}

async function listenForBroker(socketPath: string, onConnection: (socket: Socket) => void): Promise<Server | null> {
  const server = createServer(onConnection);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: Server | null): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    server.once("error", (error: NodeJS.ErrnoException) => {
      server.close();
      if (error.code === "EADDRINUSE") finish(null);
      else reject(error);
    });
    server.once("listening", () => {
      void fs.chmod(socketPath, 0o600).catch(() => undefined);
      finish(server);
    });
    server.listen(socketPath);
  });
}

function parseHandshake(buffer: Buffer): { mode: string; rest: Buffer } | null {
  const newline = buffer.indexOf(10);
  if (newline < 0) return null;
  const line = buffer.subarray(0, newline).toString("utf8").trim();
  try {
    const value = JSON.parse(line) as { crossgenMcpBroker?: unknown; mode?: unknown };
    if (value.crossgenMcpBroker !== 1 || typeof value.mode !== "string") return null;
    return { mode: value.mode, rest: buffer.subarray(newline + 1) };
  } catch {
    return null;
  }
}

function attachClient(
  socket: Socket,
  options: McpBrokerOptions,
  onFinished: () => void
): void {
  socket.pause();
  let pending = Buffer.alloc(0);
  let sessionStarted = false;

  const rejectClient = (): void => {
    socket.removeListener("data", onData);
    socket.destroy();
    onFinished();
  };

  const onData = (chunk: Buffer): void => {
    if (sessionStarted) return;
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > MAX_HANDSHAKE_BYTES) {
      rejectClient();
      return;
    }
    const handshake = parseHandshake(pending);
    if (!handshake) {
      if (pending.includes(10)) rejectClient();
      return;
    }
    sessionStarted = true;
    socket.removeListener("data", onData);
    const input = new PassThrough();
    if (handshake.rest.length) input.write(handshake.rest);
    socket.pipe(input);
    socket.resume();
    void options.runSession({
      input,
      output: socket,
      mode: handshake.mode,
      // The broker owns lifecycle. Socket close and the parent watchdog are
      // stronger signals than per-session idle timers for proxied clients.
      idleTimeoutMs: 0
    }).catch(() => undefined).finally(() => {
      socket.unpipe(input);
      input.destroy();
      socket.destroy();
      onFinished();
    });
  };

  socket.on("data", onData);
  socket.once("error", () => {
    socket.destroy();
    onFinished();
  });
  socket.once("close", onFinished);
  socket.resume();
}

function proxySession(options: McpBrokerOptions, socket: Socket): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      options.input.removeListener("data", onInput);
      resolve(code);
    };
    const onInput = (chunk: Buffer | string): void => {
      if (!socket.destroyed) socket.write(chunk);
    };
    options.input.on("data", onInput);
    options.input.once("end", () => {
      options.input.removeListener("data", onInput);
      socket.end();
    });
    options.input.once("error", () => {
      socket.destroy();
      finish(1);
    });
    socket.on("data", (chunk) => options.output.write(chunk));
    socket.once("error", () => finish(1));
    socket.once("close", () => finish(0));
  });
}

/**
 * Runs one local MCP worker per user data directory. Additional stdio hosts
 * become socket proxies, so parallel agents do not spawn parallel Electron
 * workers while retaining independent MCP sessions and permission modes.
 */
export async function runMcpWithBroker(options: McpBrokerOptions): Promise<number> {
  const existing = await connectExisting(options.socketPath, options.mode);
  if (existing) return proxySession(options, existing);

  let server: Server | null = null;
  const clients = new Set<Socket>();
  const onConnection = (socket: Socket): void => {
    clients.add(socket);
    let removed = false;
    const removeClient = (): void => {
      if (removed) return;
      removed = true;
      clients.delete(socket);
    };
    attachClient(socket, options, removeClient);
  };

  server = await listenForBroker(options.socketPath, onConnection);
  if (!server) {
    const raced = await connectExisting(options.socketPath, options.mode);
    if (raced) return proxySession(options, raced);
    await removeSocket(options.socketPath);
    server = await listenForBroker(options.socketPath, onConnection);
    if (!server) throw new Error("Unable to acquire the CrossGen MCP broker socket.");
  }

  let localResult: number;
  try {
    localResult = await options.runSession({
      input: options.input,
      output: options.output,
      mode: options.mode,
      idleTimeoutMs: 0
    });
    // A local stdio host can disconnect while socket clients remain active.
    // Keep the broker alive until the last proxied session finishes.
    if (clients.size > 0) {
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (clients.size === 0) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
        timer.unref?.();
      });
    }
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await removeSocket(options.socketPath);
  }
  return localResult;
}
