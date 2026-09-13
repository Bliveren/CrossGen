#!/usr/bin/env node
/**
 * Packaged Electron rollback smoke for CROSSGEN_SKETCH_ENABLED=0.
 *
 * This intentionally uses no provider credential. It verifies that Sketch is
 * hidden and rejected at every bridge boundary while ordinary workspace
 * persistence and read-only surfaces remain available.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const APP_EXECUTABLE = process.env.CROSSGEN_APP_EXECUTABLE
  ? path.resolve(process.env.CROSSGEN_APP_EXECUTABLE)
  : path.join(ROOT, "release", "mac-arm64", "CrossGen.app", "Contents", "MacOS", "CrossGen");
const CDP_PORT = Number(process.env.CROSSGEN_SKETCH_FLAG_CDP_PORT ?? 9238);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, label, timeoutMs = 15000, intervalMs = 100) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  throw new Error(`${label}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(target) {
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    await this.call("Runtime.enable");
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  async close() {
    for (const pending of this.pending.values()) pending.reject(new Error("CDP client closed"));
    this.pending.clear();
    this.socket.close();
  }
}

async function findTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  return targets.find((target) => target.type === "page" && target.url.includes("dist-renderer/index.html"));
}

async function startPackagedApp(userDataDir) {
  const child = spawn(APP_EXECUTABLE, [`--remote-debugging-port=${CDP_PORT}`, "--no-sandbox"], {
    cwd: ROOT,
    env: {
      ...process.env,
      CROSSGEN_USER_DATA_DIR: userDataDir,
      CROSSGEN_SKETCH_ENABLED: "0",
      IMAGE2TOOLS_UPDATE_URL: "http://127.0.0.1:9/updates.json"
    },
    stdio: "ignore"
  });
  const target = await waitFor(findTarget, "packaged Electron CDP target");
  const cdp = new CdpClient(target);
  await cdp.open();
  await waitFor(async () => (await cdp.evaluate("document.title")) === "CrossGen", "CrossGen renderer");
  return { child, cdp };
}

const openAiParams = {
  providerKind: "openai",
  launchId: "gpt-image-2",
  model: "gpt-image-2",
  imageRoute: "image-api",
  referenceImageMode: "original",
  size: "auto",
  quality: "auto",
  outputFormat: "png",
  outputCompression: 100,
  background: "auto",
  n: 1,
  stream: false,
  partialImages: 0,
  moderation: "auto",
  timeoutMs: 30000
};

async function main() {
  const executableStat = await stat(APP_EXECUTABLE).catch(() => null);
  assert(executableStat, `packaged executable not found: ${APP_EXECUTABLE}`);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-v034-sketch-flag-"));
  let child;
  let cdp;
  try {
    ({ child, cdp } = await startPackagedApp(userDataDir));
    const snapshot = await waitFor(
      async () => {
        const value = await cdp.evaluate("window.crossgen?.getSnapshot()");
        return value?.features?.sketchEnabled === false ? value : null;
      },
      "feature flag snapshot"
    );
    assert(snapshot.features.sketchEnabled === false, "Sketch feature flag was not disabled");
    await waitFor(
      async () => !(await cdp.evaluate("Boolean(document.querySelector('button.reference-sketch-button'))")),
      "Sketch renderer entry removal"
    );

    const bridgeChecks = await cdp.evaluate(`(async () => {
      const sketchDocument = {
        schemaVersion: 1,
        width: 512,
        height: 512,
        background: "white",
        strokes: [{
          id: "flag-off-stroke",
          tool: "brush",
          color: "#111827",
          size: 8,
          opacity: 1,
          points: [{ x: 16, y: 16 }, { x: 48, y: 48 }]
        }]
      };
      const standardDraft = {
        mode: "generate",
        workflow: "standard",
        prompt: "flag off ordinary text-to-image draft",
        params: ${JSON.stringify(openAiParams)},
        inputAssets: [],
        brushSize: 24
      };
      const editDraft = {
        ...standardDraft,
        mode: "edit",
        prompt: "flag off ordinary image-to-image draft",
        inputAssets: [{
          id: "ordinary-reference",
          name: "reference.png",
          path: "/tmp/crossgen-flag-off-reference.png",
          mimeType: "image/png",
          sizeBytes: 1
        }]
      };
      const maskDraft = {
        ...editDraft,
        mode: "inpaint",
        prompt: "flag off ordinary mask draft",
        maskAsset: {
          id: "ordinary-mask",
          name: "mask.png",
          path: "/tmp/crossgen-flag-off-mask.png",
          mimeType: "image/png",
          sizeBytes: 1
        },
        maskDataUrl: "data:image/png;base64,iVBORw0KGgo="
      };
      const outcomes = {};
      try { await window.crossgen.saveSketchAsset({}); outcomes.saveSketchAsset = "accepted"; } catch (error) { outcomes.saveSketchAsset = String(error?.message || error); }
      try { await window.crossgen.loadSketchDocument("flag_off_artifact"); outcomes.loadSketchDocument = "accepted"; } catch (error) { outcomes.loadSketchDocument = String(error?.message || error); }
      try { await window.crossgen.saveDraft({ ...standardDraft, mode: "edit", workflow: "sketch", sketch: sketchDocument }); outcomes.saveSketchDraft = "accepted"; } catch (error) { outcomes.saveSketchDraft = String(error?.message || error); }
      try { await window.crossgen.runJob({ workflow: "sketch" }); outcomes.runSketchJob = "accepted"; } catch (error) { outcomes.runSketchJob = String(error?.message || error); }
      try { outcomes.textDraft = (await window.crossgen.saveDraft(standardDraft)).mode; } catch (error) { outcomes.textDraft = String(error?.message || error); }
      try { outcomes.editDraft = (await window.crossgen.saveDraft(editDraft)).mode; } catch (error) { outcomes.editDraft = String(error?.message || error); }
      try { outcomes.maskDraft = (await window.crossgen.saveDraft(maskDraft)).mode; } catch (error) { outcomes.maskDraft = String(error?.message || error); }
      try { outcomes.historyCount = (await window.crossgen.getSnapshot()).history.length; } catch (error) { outcomes.historyCount = String(error?.message || error); }
      try { outcomes.galleryCount = (await window.crossgen.listGallery()).length; } catch (error) { outcomes.galleryCount = String(error?.message || error); }
      try { outcomes.queueTotal = (await window.crossgen.getQueueSnapshot()).counts.total; } catch (error) { outcomes.queueTotal = String(error?.message || error); }
      return outcomes;
    })()`);

    for (const key of ["saveSketchAsset", "loadSketchDocument", "saveSketchDraft", "runSketchJob"]) {
      assert(typeof bridgeChecks[key] === "string" && bridgeChecks[key] !== "accepted", `feature flag did not reject ${key}`);
      assert(bridgeChecks[key].includes("feature flag") || bridgeChecks[key].includes("关闭") || bridgeChecks[key].includes("disabled"), `${key} rejection was not explicit`);
    }
    assert(bridgeChecks.textDraft === "generate", "ordinary text-to-image draft did not remain available");
    assert(bridgeChecks.editDraft === "edit", "ordinary image-to-image draft did not remain available");
    assert(bridgeChecks.maskDraft === "inpaint", "ordinary mask draft did not remain available");
    assert(bridgeChecks.historyCount === 0, "History read surface failed under Sketch rollback");
    assert(bridgeChecks.galleryCount === 0, "Gallery read surface failed under Sketch rollback");
    assert(bridgeChecks.queueTotal === 0, "Queue read surface failed under Sketch rollback");

    console.log(JSON.stringify({
      app: APP_EXECUTABLE,
      userDataDir: "[temporary]",
      cdpPort: CDP_PORT,
      flag: "CROSSGEN_SKETCH_ENABLED=0",
      checks: [
        "renderer Sketch entry hidden",
        "Sketch asset IPC rejected",
        "Sketch document IPC rejected",
        "Sketch draft rejected",
        "Sketch queue request rejected",
        "ordinary text-to-image draft retained",
        "ordinary image-to-image draft retained",
        "ordinary mask draft retained",
        "History/Gallery/Queue reads retained"
      ]
    }, null, 2));
  } finally {
    await cdp?.close().catch(() => undefined);
    if (child && !child.killed) child.kill("SIGTERM");
    await wait(350);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[sketch-feature-flag-smoke] ${error.stack || error.message || error}`);
  process.exit(1);
});
