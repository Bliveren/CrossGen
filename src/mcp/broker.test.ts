import { PassThrough, type Readable, type Writable } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMcpWithBroker, socketPathForUserData } from "./broker.js";

function session(options: { input: Readable; output: Writable; mode: string }): Promise<number> {
  return new Promise((resolve) => {
    options.input.on("data", (chunk) => {
      options.output.write(`handled:${options.mode}:${chunk.toString("utf8")}`);
    });
    options.input.on("end", () => resolve(0));
  });
}

describe("MCP broker", () => {
  it("shares one worker socket between two stdio sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crossgen-mcp-broker-"));
    const socketPath = socketPathForUserData(root);
    const firstInput = new PassThrough();
    const firstOutput = new PassThrough();
    const firstOutputChunks: string[] = [];
    firstOutput.on("data", (chunk) => firstOutputChunks.push(chunk.toString("utf8")));
    const first = runMcpWithBroker({
      socketPath,
      mode: "readonly",
      idleTimeoutMs: 1000,
      input: firstInput,
      output: firstOutput,
      runSession: ({ input, output, mode }) => session({ input, output, mode })
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const secondInput = new PassThrough();
    const secondOutput = new PassThrough();
    const secondOutputChunks: string[] = [];
    secondOutput.on("data", (chunk) => secondOutputChunks.push(chunk.toString("utf8")));
    const second = runMcpWithBroker({
      socketPath,
      mode: "write",
      idleTimeoutMs: 1000,
      input: secondInput,
      output: secondOutput,
      runSession: ({ input, output, mode }) => session({ input, output, mode })
    });

    secondInput.end("second");
    await expect(second).resolves.toBe(0);
    expect(secondOutputChunks.join("")).toContain("handled:write:second");

    firstInput.end("first");
    await expect(first).resolves.toBe(0);
    expect(firstOutputChunks.join("")).toContain("handled:readonly:first");
    await expect(fs.stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
