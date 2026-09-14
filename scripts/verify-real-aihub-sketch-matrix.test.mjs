// @vitest-environment node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/verify-real-aihub-sketch-matrix.mjs");
const execFileAsync = promisify(execFile);
const apiKey = "sk-test-secret";
const imageBase64 = Buffer.from("mock-image-bytes".repeat(12)).toString("base64");

async function startServer(models, options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && (request.url === "/models" || request.url === "/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
      return;
    }

    if (
      request.method === "POST" &&
      (request.url === "/chat/completions" || request.url === "/v1/chat/completions")
    ) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(body);
      const model = String(body.model ?? "");
      if (options.failInvalidModel && model.includes("invalid-recovery-probe")) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: {
            code: "model_not_found",
            message: `token ${apiKey} cannot use ${model}`
          }
        }));
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-cache",
        "content-type": "text/event-stream",
        connection: "keep-alive"
      });
      response.end(
        `data: ${JSON.stringify({
          choices: [{
            message: {
              content: options.bareBase64 ? imageBase64 : `data:image/png;base64,${imageBase64}`
            }
          }]
        })}\n\ndata: [DONE]\n\n`
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock AIHub server did not expose a TCP address.");
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

async function run(env) {
  try {
    const result = await execFileAsync("node", [scriptPath], {
      env: {
        ...process.env,
        ...env
      },
      maxBuffer: 4 * 1024 * 1024
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: Number(error?.code ?? 1),
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? "")
    };
  }
}

function summaryPath(output) {
  const match = output.match(/(?:Summary|AIHub Sketch matrix summary): (.+summary\.json)/);
  if (!match) throw new Error(`Verifier did not report a summary path:\n${output}`);
  return match[1].trim();
}

async function readSummary(output) {
  return JSON.parse(await readFile(summaryPath(output), "utf8"));
}

async function withTempOutput(callback) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "crossgen-aihub-sketch-test-"));
  try {
    return await callback(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

describe("real AIHub Sketch matrix verifier", () => {
  it("does not send paid requests when the literal Nano Banana target is absent", async () => {
    const mock = await startServer([
      "gpt-image-2.5-sunburst",
      "gemini-3.1-flash-image"
    ]);
    await withTempOutput(async (tempRoot) => {
      try {
        const result = await run({
          CROSSGEN_REAL_AIHUB_BASE_URL: mock.baseURL,
          CROSSGEN_REAL_AIHUB_API_KEY: apiKey,
          CROSSGEN_REAL_AIHUB_SKETCH_OUTPUT_DIR: path.join(tempRoot, "artifacts"),
          CROSSGEN_REAL_AIHUB_SKETCH_COMMIT: "test-commit"
        });
        const summary = await readSummary(`${result.stdout}\n${result.stderr}`);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("AIHub Sketch matrix pending: nano-banana-3");
        expect(mock.requests).toHaveLength(0);
        expect(summary.status).toBe("pending-target-models");
        expect(summary.requestCount).toBe(0);
        expect(summary.targets.nano.directAliasListed).toBe(false);
        expect(summary.targets.nano.providerModelIdsListed).toEqual(["gemini-3.1-flash-image"]);
        expect(JSON.stringify(summary)).not.toContain(apiKey);
      } finally {
        await mock.close();
      }
    });
  });

  it("requires explicit cost confirmation even when both target ids are visible", async () => {
    const mock = await startServer([
      "gpt-image-2.5-sunburst",
      "nano-banana-3"
    ]);
    await withTempOutput(async (tempRoot) => {
      try {
        const result = await run({
          CROSSGEN_REAL_AIHUB_BASE_URL: mock.baseURL,
          CROSSGEN_REAL_AIHUB_API_KEY: apiKey,
          CROSSGEN_REAL_AIHUB_SKETCH_OUTPUT_DIR: path.join(tempRoot, "artifacts")
        });
        const summary = await readSummary(`${result.stdout}\n${result.stderr}`);

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("requires CROSSGEN_REAL_AIHUB_SKETCH_ACCEPT_COST=1");
        expect(mock.requests).toHaveLength(0);
        expect(summary.status).toBe("blocked-cost-confirmation");
        expect(summary.requestCount).toBe(0);
        expect(summary.costConfirmed).toBe(false);
      } finally {
        await mock.close();
      }
    });
  });

  it("records redacted outputs and the expected failure-recovery retry", async () => {
    const mock = await startServer(
      ["gpt-image-2.5-sunburst", "nano-banana-3"],
      { failInvalidModel: true, bareBase64: true }
    );
    await withTempOutput(async (tempRoot) => {
      try {
        const result = await run({
          CROSSGEN_REAL_AIHUB_BASE_URL: mock.baseURL,
          CROSSGEN_REAL_AIHUB_API_KEY: apiKey,
          CROSSGEN_REAL_AIHUB_SKETCH_OUTPUT_DIR: path.join(tempRoot, "artifacts"),
          CROSSGEN_REAL_AIHUB_SKETCH_COMMIT: "test-commit",
          CROSSGEN_REAL_AIHUB_SKETCH_ACCEPT_COST: "1",
          CROSSGEN_REAL_AIHUB_SKETCH_MAX_ATTEMPTS: "1"
        });
        const summary = await readSummary(`${result.stdout}\n${result.stderr}`);

        expect(result.exitCode).toBe(0);
        expect(mock.requests).toHaveLength(8);
        expect(summary.requestCount).toBe(8);
        expect(summary.status).toBe("awaiting-human-quality-review");
        expect(summary.operations).toHaveLength(8);
        expect(summary.operations.filter((operation) => operation.result === "pass")).toHaveLength(7);
        expect(summary.operations.filter((operation) => operation.result === "expected-failure")).toHaveLength(1);
        expect(summary.operations.at(-1)).toMatchObject({
          result: "pass",
          retry: false,
          recoveryFrom: "provider_error",
          recoveryProbeResult: "expected-failure"
        });
        expect(summary.operations.find((operation) => operation.result === "expected-failure")?.error)
          .not.toContain(apiKey);
        expect(JSON.stringify(summary)).not.toContain(apiKey);
        expect(summary.operations.filter((operation) => operation.output)).toHaveLength(7);
      } finally {
        await mock.close();
      }
    });
  });

  it("marks an explicitly mapped Gemini provider model as non-literal Nano evidence", async () => {
    const mock = await startServer([
      "gpt-image-2.5-sunburst",
      "gemini-3.1-flash-image"
    ]);
    await withTempOutput(async (tempRoot) => {
      try {
        const result = await run({
          CROSSGEN_REAL_AIHUB_BASE_URL: mock.baseURL,
          CROSSGEN_REAL_AIHUB_API_KEY: apiKey,
          CROSSGEN_REAL_AIHUB_NANO_SKETCH_MODEL: "gemini-3.1-flash-image",
          CROSSGEN_REAL_AIHUB_SKETCH_OUTPUT_DIR: path.join(tempRoot, "artifacts"),
          CROSSGEN_REAL_AIHUB_SKETCH_COMMIT: "test-commit"
        });
        const summary = await readSummary(`${result.stdout}\n${result.stderr}`);

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("requires CROSSGEN_REAL_AIHUB_SKETCH_ACCEPT_COST=1");
        expect(mock.requests).toHaveLength(0);
        expect(summary.status).toBe("blocked-cost-confirmation");
        expect(summary.targets.nano.listed).toBe(true);
        expect(summary.targets.nano.directAliasListed).toBe(false);
        expect(summary.targets.nano.providerModelIdsListed).toEqual(["gemini-3.1-flash-image"]);
        expect(summary.targets.nano.evidenceClass).toBe("explicit-provider-model-for-nano-workflow");
        expect(summary.targets.nano.caveat).toContain("does not prove");
      } finally {
        await mock.close();
      }
    });
  });
});
