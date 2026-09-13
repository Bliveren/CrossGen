#!/usr/bin/env node
/**
 * Packaged Electron smoke for the v0.3.4 Sketch workspace.
 *
 * The smoke uses a temporary user-data directory and a local /models/
 * responder. It proves the renderer/main-process interaction chain without
 * making a real provider request or recording a credential.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const APP_EXECUTABLE = process.env.CROSSGEN_APP_EXECUTABLE
  ? path.resolve(process.env.CROSSGEN_APP_EXECUTABLE)
  : path.join(ROOT, "release", "mac-arm64", "CrossGen.app", "Contents", "MacOS", "CrossGen");
const OUTPUT_DIR = path.join(ROOT, "output", "playwright", "v034-sketch-packaged");
const CDP_PORT = Number(process.env.CROSSGEN_SKETCH_CDP_PORT ?? 9237);
const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "960x720", width: 960, height: 720 },
  { name: "760x640", width: 760, height: 640 }
];
const FAKE_API_KEY = "sk-test-local-123456789";
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

function createLocalProviderServer() {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const modelData = [
    {
      id: "gpt-image-2",
      object: "model",
      displayName: "GPT Image 2",
      capabilities: { image: true }
    },
    {
      id: "gpt-image-2.5-sunburst",
      object: "model",
      displayName: "GPT Image 2.5",
      capabilities: { image: true }
    },
    {
      id: "gemini-3.1-flash-image",
      object: "model",
      displayName: "Nano Banana 3",
      capabilities: { image: true }
    }
  ];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const json = (value) => {
      const payload = Buffer.from(JSON.stringify(value));
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": payload.byteLength,
        "cache-control": "no-store"
      });
      response.end(payload);
    };

    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      json({ object: "list", data: modelData });
      return;
    }
    if (request.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      const payload = Buffer.from(`data: ${JSON.stringify({
        choices: [{ delta: { content: "", images: [{ b64_json: tinyPngBase64 }] } }]
      })}\n\n`);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "content-length": payload.byteLength
      });
      response.end(payload);
      return;
    }
    if (request.method === "POST" && url.pathname.endsWith("/responses")) {
      json({
        output: [{
          type: "image_generation_call",
          id: "igc_local_smoke",
          result: tinyPngBase64
        }]
      });
      return;
    }
    if (request.method === "POST" && (url.pathname.endsWith("/images/generations") || url.pathname.endsWith("/images/edits"))) {
      json({ data: [{ b64_json: tinyPngBase64 }] });
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  return { server, modelData };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object", "local provider server did not expose an address");
  return address.port;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function writeFixtureState(userDataDir, baseURL, referencePath, maskPath, referenceDataUrl, maskDataUrl) {
  const now = new Date().toISOString();
  const encodedKey = Buffer.from(FAKE_API_KEY, "utf8").toString("base64");
  const state = {
    version: 5,
    providers: [{
      id: "default",
      kind: "openai",
      name: "Local smoke provider",
      baseURL,
      enabled: true,
      defaultModel: "gpt-image-2",
      defaultSize: "auto",
      defaultQuality: "auto",
      timeoutMs: 30000,
      streamingPartialsEnabled: false,
      discoveredModels: [
        { id: "gpt-image-2", providerKind: "openai", displayName: "GPT Image 2", raw: { capabilities: { image: true } } },
        { id: "gpt-image-2.5-sunburst", providerKind: "openai", displayName: "GPT Image 2.5", raw: { capabilities: { image: true } } },
        { id: "gemini-3.1-flash-image", providerKind: "gemini", displayName: "Nano Banana 3", raw: { capabilities: { image: true } } }
      ],
      lastModelDiscoveryAt: now,
      activeLaunchId: "gpt-image-2",
      activeModelId: "gpt-image-2",
      updatedAt: now,
      encryptedApiKey: `plain:${encodedKey}`,
      encryption: "localFallback"
    }],
    activeProviderId: "default",
    history: [],
    promptTemplates: [],
    galleryFolders: [],
    galleryAssets: [],
    queueConfig: {
      maxGlobalRunning: 1,
      providerConcurrency: {}
    },
    draft: {
      activeLaunchId: "gpt-image-2",
      activeModelId: "gpt-image-2",
      mode: "inpaint",
      workflow: "standard",
      prompt: "local packaged Sketch smoke",
      params: {
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
      },
      inputAssets: [{
        id: "fixture-reference",
        name: "reference.png",
        path: referencePath,
        mimeType: "image/png",
        sizeBytes: 0,
        role: "reference",
        dataUrl: referenceDataUrl
      }],
      maskAsset: {
        id: "fixture-mask",
        name: "mask.png",
        path: maskPath,
        mimeType: "image/png",
        sizeBytes: 0,
        dataUrl: maskDataUrl
      },
      maskDataUrl,
      brushSize: 24,
      updatedAt: now
    }
  };
  await writeFile(path.join(userDataDir, "image2tools-state.v1.json"), JSON.stringify(state, null, 2));
}

class CdpClient {
  constructor(target) {
    this.target = target;
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
    await this.call("Page.enable");
    await this.call("Runtime.enable");
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, options = {}) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise ?? true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  async setViewport(width, height) {
    await this.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height
    });
  }

  async screenshot(filePath) {
    const result = await this.call("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(filePath, Buffer.from(result.data, "base64"));
  }

  async close() {
    for (const pending of this.pending.values()) pending.reject(new Error("CDP client closed"));
    this.pending.clear();
    this.socket.close();
  }
}

async function findTarget(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return targets.find((target) => target.type === "page" && target.url.includes("dist-renderer/index.html"));
}

async function startPackagedApp(userDataDir, providerPort) {
  const child = spawn(APP_EXECUTABLE, [`--remote-debugging-port=${CDP_PORT}`, "--no-sandbox"], {
    cwd: ROOT,
    env: {
      ...process.env,
      CROSSGEN_USER_DATA_DIR: userDataDir,
      CROSSGEN_SKETCH_ENABLED: "1",
      IMAGE2TOOLS_UPDATE_URL: `http://127.0.0.1:${providerPort}/updates.json`
    },
    stdio: "ignore"
  });
  const target = await waitFor(() => findTarget(CDP_PORT), "packaged Electron CDP target");
  const cdp = new CdpClient(target);
  await cdp.open();
  await waitFor(async () => {
    const title = await cdp.evaluate("document.title");
    return title === "CrossGen";
  }, "CrossGen renderer");
  return { child, cdp };
}

async function stopPackagedApp(child, cdp) {
  await cdp?.close().catch(() => undefined);
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await waitFor(
    () => child.exitCode !== null || child.signalCode !== null,
    "packaged Electron shutdown",
    5000,
    100
  ).catch(() => undefined);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await waitFor(
    async () => {
      try {
        return !(await findTarget(CDP_PORT));
      } catch {
        return true;
      }
    },
    "packaged Electron CDP cleanup",
    5000,
    100
  ).catch(() => undefined);
}

async function clickButton(cdp, matcher, label) {
  const clicked = await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    const predicate = ${matcher};
    const button = buttons.find(predicate);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `button not clickable: ${label}`);
  await wait(350);
}

async function bodyText(cdp) {
  return cdp.evaluate("document.body.innerText");
}

async function pointerStroke(cdp) {
  const rect = await cdp.evaluate(`(() => {
    const canvas = document.querySelector("canvas.sketch-canvas");
    if (!canvas) return null;
    return canvas.getBoundingClientRect().toJSON();
  })()`);
  assert(rect, "Sketch canvas is not mounted");
  const points = Array.from({ length: 9 }, (_, index) => ({
    x: rect.left + rect.width * (0.28 + index * 0.045),
    y: rect.top + rect.height * (0.28 + index * 0.035)
  }));
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: points[0].x, y: points[0].y, button: "none", buttons: 0 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: points[0].x, y: points[0].y, button: "left", buttons: 1, clickCount: 1 });
  for (const point of points.slice(1)) {
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "left", buttons: 1 });
  }
  const last = points[points.length - 1];
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: last.x, y: last.y, button: "left", buttons: 0, clickCount: 1 });
  await wait(250);
}

async function fillPrompt(cdp, value) {
  const result = await cdp.evaluate(`(() => {
    const field = document.querySelector("textarea[aria-label='提示词'], textarea");
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert(result, "prompt textarea is not available");
  await wait(120);
}

async function main() {
  const executableStat = await stat(APP_EXECUTABLE).catch(() => null);
  assert(executableStat, `packaged executable not found: ${APP_EXECUTABLE}`);
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await (await import("node:fs/promises")).mkdir(OUTPUT_DIR, { recursive: true });

  const { server } = createLocalProviderServer();
  const providerPort = await listen(server);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "crossgen-v034-sketch-"));
  const referencePath = path.join(userDataDir, "reference.png");
  const maskPath = path.join(userDataDir, "mask.png");
  const iconBytes = await readFile(path.join(ROOT, "build", "icon.png"));
  const referenceDataUrl = `data:image/png;base64,${iconBytes.toString("base64")}`;
  const maskDataUrl = referenceDataUrl;
  await writeFile(referencePath, iconBytes);
  await writeFile(maskPath, iconBytes);
  await writeFixtureState(userDataDir, `http://127.0.0.1:${providerPort}/v1`, referencePath, maskPath, referenceDataUrl, maskDataUrl);
  if (process.env.CROSSGEN_SKETCH_DEBUG === "1") {
    console.error(`[sketch-packaged-smoke] fixture state: ${userDataDir}\n${await readFile(path.join(userDataDir, "image2tools-state.v1.json"), "utf8")}`);
  }

  let child;
  let cdp;
  try {
    ({ child, cdp } = await startPackagedApp(userDataDir, providerPort));
    await waitFor(async () => (await bodyText(cdp)).includes("图生图"), "image-to-image workspace");
    await cdp.setViewport(1440, 900);
    await wait(180);
    const img2imgTab = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => candidate.innerText.trim() === "图生图");
      if (!button) return false;
      if (!button.classList.contains("active")) button.click();
      return true;
    })()`);
    assert(img2imgTab, "image-to-image mode tab is missing");
    await wait(180);
    const initial = await cdp.evaluate(`(() => ({
      features: window.crossgen?.getSnapshot ? null : null,
      sketchButton: Boolean([...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "新建 Sketch")),
      maskVisible: document.body.innerText.includes("蒙版")
    }))()`);
    assert(initial.sketchButton, "Sketch entry is missing from the image-to-image reference area");

    await clickButton(cdp, "(button) => button.classList.contains('reference-sketch-button')", "新建 Sketch");
    await wait(500);
    if ((await bodyText(cdp)).includes("清除蒙版并打开 Sketch")) {
      await clickButton(cdp, "(button) => button.innerText.trim() === '清除蒙版并打开 Sketch'", "clear mask and open Sketch");
    }
    if (process.env.CROSSGEN_SKETCH_PAUSE === "1") {
      console.error("[sketch-packaged-smoke] paused after Sketch entry; inspect CDP port before continuing");
      await wait(120000);
    }
    await waitFor(async () => (await bodyText(cdp)).includes("Sketch 输入"), "Sketch editor");
    await pointerStroke(cdp);
    const drawnText = await bodyText(cdp);
    assert(/1 strokes/.test(drawnText), "pointer drawing did not create a Sketch stroke");

    await clickButton(cdp, "(button) => button.getAttribute('aria-label') === '回退'", "undo");
    await waitFor(async () => !(await bodyText(cdp)).includes("1 strokes"), "Sketch undo");
    await clickButton(cdp, "(button) => button.getAttribute('aria-label') === '重做'", "redo");
    await wait(120);
    const redoText = await bodyText(cdp);
    assert(/1 strokes/.test(redoText), "Sketch redo did not restore a stroke state");

    const underlayAvailable = await cdp.evaluate(`(() => Boolean(document.querySelector(".sketch-underlay-control select option[value='fixture-reference'], .sketch-underlay-control select option:not([value=''])")))()`);
    assert(underlayAvailable, "reference underlay selector is missing");
    await cdp.evaluate(`(() => {
      const select = document.querySelector(".sketch-underlay-control select");
      if (!select || select.options.length < 2) return false;
      select.value = select.options[1].value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await wait(120);
    assert(await cdp.evaluate("Boolean(document.querySelector('.sketch-underlay-control select')?.value)"), "reference underlay was not selected");

    await clickButton(cdp, "(button) => button.getAttribute('aria-label') === '清除'", "clear");
    await waitFor(async () => (await bodyText(cdp)).includes("0 strokes"), "Sketch clear");
    await pointerStroke(cdp);
    await clickButton(cdp, "(button) => button.innerText.trim() === '保存并使用'", "save Sketch");
    await waitFor(
      async () => cdp.evaluate("Boolean(document.querySelector(\"button[aria-label='编辑 Sketch']\"))"),
      "saved Sketch input preview"
    );
    const savedText = await bodyText(cdp);
    assert(savedText.includes("Sketch"), "saved Sketch was not returned to the reference area");
    assert(!savedText.includes("清除蒙版并打开 Sketch"), "Mask was not cleared when Sketch became the active input");

    // Give the renderer's debounced draft writer time to persist the saved
    // Sketch, then restart the exact same packaged app against the same
    // user-data directory. This verifies that the artifact and draft survive
    // a real process boundary rather than only React state changes.
    await wait(1000);
    await stopPackagedApp(child, cdp);
    ({ child, cdp } = await startPackagedApp(userDataDir, providerPort));
    await waitFor(async () => (await bodyText(cdp)).includes("Sketch"), "Sketch draft after restart");
    const restoredSketch = await cdp.evaluate(`(async () => {
      const snapshot = await window.crossgen?.getSnapshot?.();
      return {
        sketchTile: Boolean(document.querySelector("button[aria-label='编辑 Sketch']")),
        sketchDraft: snapshot?.draft?.workflow === "sketch",
        sketchAsset: Boolean(snapshot?.draft?.inputAssets?.some((asset) => asset.role === "sketch")),
        maskVisible: document.body.innerText.includes("蒙版")
      };
    })()`);
    assert(restoredSketch.sketchTile, "saved Sketch tile was not restored after packaged restart");
    assert(restoredSketch.sketchDraft, "Sketch draft workflow was not restored after packaged restart");
    assert(restoredSketch.sketchAsset, "Sketch input asset was not restored after packaged restart");

    await fillPrompt(cdp, "a local packaged Sketch smoke image");
    await clickButton(cdp, "(button) => button.getAttribute('aria-label') === '使用 Sketch'", "generate Sketch");
    await waitFor(async () => (await bodyText(cdp)).includes("历史") || (await bodyText(cdp)).includes("生成中"), "Sketch queue start", 10000);
    await waitFor(async () => {
      const text = await bodyText(cdp);
      return text.includes("输入") && text.includes("结果") && !text.includes("生成中");
    }, "Sketch input/result switch", 20000);
    const resultToggle = await cdp.evaluate(`(() => ({
      input: Boolean([...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "输入")),
      result: Boolean([...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "结果"))
    }))()`);
    assert(resultToggle.input && resultToggle.result, "input/result studio toggle is missing after generation");
    await clickButton(cdp, "(button) => button.innerText.trim() === '输入'", "input view");
    await wait(120);
    assert((await bodyText(cdp)).includes("Sketch"), "input view did not restore Sketch preview");
    await clickButton(cdp, "(button) => button.innerText.trim() === '结果'", "result view");
    await wait(120);

    // A Sketch must not permanently block ordinary reference editing. Remove
    // the Sketch, open the remaining reference, and enter the bounded Mask
    // editor through the normal confirmation path.
    const removedSketch = await cdp.evaluate(`(() => {
      const button = document.querySelector(".sketch-reference-tile .tile-remove");
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    assert(removedSketch, "Sketch tile remove action is missing");
    await wait(180);
    const remainingReference = await cdp.evaluate(`(() => {
      const tiles = [...document.querySelectorAll(".reference-thumb-tile")];
      const reference = tiles.find((tile) => !tile.classList.contains("sketch-reference-tile"));
      if (!reference) return false;
      reference.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        detail: 2,
        view: window
      }));
      return true;
    })()`);
    assert(remainingReference, "ordinary reference tile disappeared after Sketch removal");
    await waitFor(
      async () => cdp.evaluate("Boolean(document.querySelector('.reference-preview-dialog'))"),
      "reference preview after Sketch removal"
    );
    await clickButton(cdp, "(button) => button.getAttribute('aria-label') === '添加蒙版'", "open reference Mask tools");
    if ((await bodyText(cdp)).includes("将此图设为首张参考图")) {
      await clickButton(cdp, "(button) => button.innerText.trim() === '设为首张并编辑'", "promote reference for Mask");
    }
    await waitFor(
      async () => cdp.evaluate("Boolean(document.querySelector('.reference-preview-stage.masking'))"),
      "ordinary reference Mask editor after Sketch removal"
    );
    assert(!(await cdp.evaluate("Boolean(document.querySelector('.sketch-reference-tile'))")), "Sketch tile remained after explicit removal");
    await cdp.evaluate("document.querySelector('.preview-modal-close')?.click()");
    await wait(120);

    await clickButton(cdp, "(button) => button.getAttribute('aria-label')?.startsWith('启动模型')", "model picker");
    await waitFor(async () => (await bodyText(cdp)).includes("Nano Banana 3"), "model picker options");
    await clickButton(cdp, "(button) => button.innerText.includes('Nano Banana 3')", "Nano Banana 3 model");
    await waitFor(async () => (await bodyText(cdp)).toLowerCase().includes("nano banana 3"), "model switch");

    for (const viewport of VIEWPORTS) {
      await cdp.setViewport(viewport.width, viewport.height);
      await wait(180);
      const viewportReport = await cdp.evaluate(`(() => {
        const shell = document.querySelector(".app-shell");
        const body = document.body;
        const sketch = document.querySelector(".sketch-editor-shell, .sketch-canvas");
        const overflow = Math.max(body.scrollWidth - window.innerWidth, document.documentElement.scrollWidth - window.innerWidth);
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          overflow,
          shellWidth: shell?.getBoundingClientRect().width ?? 0,
          sketchVisible: Boolean(sketch)
        };
      })()`);
      assert(viewportReport.overflow <= 1, `${viewport.name} has horizontal overflow: ${viewportReport.overflow}px`);
      await cdp.screenshot(path.join(OUTPUT_DIR, `${viewport.name}.png`));
    }

    await cdp.setViewport(1440, 900);
    await wait(120);
    const sidebarState = await cdp.evaluate(`(() => {
      const collapse = document.querySelector("button.sidebar-collapse-button:not(.collapsed)");
      collapse?.click();
      return Boolean(collapse);
    })()`);
    assert(sidebarState, "sidebar collapse control is missing");
    await wait(200);
    const compactReport = await cdp.evaluate(`(() => {
      const body = document.body;
      const overflow = Math.max(body.scrollWidth - window.innerWidth, document.documentElement.scrollWidth - window.innerWidth);
      return {
        overflow,
        compact: Boolean(document.querySelector(".sidebar-mini-stack")),
        launchSummary: [...document.querySelectorAll(".sidebar-mini-stack button")].map((button) => button.getAttribute("aria-label"))
      };
    })()`);
    assert(compactReport.compact, "compact sidebar mode did not render");
    assert(compactReport.launchSummary.some((label) => label === "启动模型"), "compact sidebar does not show launch model summary");
    assert(compactReport.overflow <= 1, `compact sidebar has horizontal overflow: ${compactReport.overflow}px`);
    await cdp.screenshot(path.join(OUTPUT_DIR, "compact-sidebar.png"));

    console.log(JSON.stringify({
      app: APP_EXECUTABLE,
      userDataDir: "[temporary]",
      cdpPort: CDP_PORT,
      screenshots: VIEWPORTS.map((viewport) => `${viewport.name}.png`).concat(["compact-sidebar.png"]),
      checks: [
        "image-to-image Sketch entry",
        "pointer drawing",
        "undo/redo/clear",
        "reference underlay",
        "save-and-use",
        "packaged restart recovery of Sketch artifact and draft",
        "mock generation and input/result switching",
        "Sketch removal and ordinary reference Mask recovery",
        "model switching",
        "constrained viewports",
        "compact sidebar"
      ]
    }, null, 2));
  } catch (error) {
    if (cdp) {
      try {
        await cdp.screenshot(path.join(OUTPUT_DIR, "failure.png"));
        const diagnostics = await cdp.evaluate(`(() => ({
          viewport: { width: window.innerWidth, height: window.innerHeight },
          buttons: [...document.querySelectorAll("button")].map((button) => ({
            text: button.innerText.trim(),
            aria: button.getAttribute("aria-label"),
            cls: button.className,
            disabled: button.disabled
          })).filter((button) => button.cls.includes("sketch") || button.aria?.includes("Sketch") || button.text.includes("Sketch")),
          dialogs: [...document.querySelectorAll("[role='dialog'], .dialog-shell")].map((node) => node.innerText)
        }))()`);
        console.error(`[sketch-packaged-smoke] diagnostics at failure:\n${JSON.stringify(diagnostics, null, 2)}`);
        console.error(`[sketch-packaged-smoke] body at failure:\n${(await bodyText(cdp)).slice(-4000)}`);
      } catch {
        // Preserve the original smoke failure when the renderer is already gone.
      }
    }
    throw error;
  } finally {
    await stopPackagedApp(child, cdp);
    await wait(350);
    await closeServer(server);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[sketch-packaged-smoke] ${error.stack || error.message || error}`);
  process.exit(1);
});
