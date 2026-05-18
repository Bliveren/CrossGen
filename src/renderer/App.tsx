import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_PARAMS,
  getValidationError,
  validateGptImage2Size
} from "../shared/validation";
import type { AppSnapshot, ImageParams, InputAsset, ProviderConfig } from "../shared/types";

const fallbackConfig: ProviderConfig = {
  id: "default",
  name: "OpenAI",
  apiKeySaved: false,
  baseURL: DEFAULT_BASE_URL,
  enabled: true,
  defaultModel: DEFAULT_IMAGE_PARAMS.model,
  defaultSize: DEFAULT_IMAGE_PARAMS.size,
  defaultQuality: DEFAULT_IMAGE_PARAMS.quality,
  timeoutMs: DEFAULT_IMAGE_PARAMS.timeoutMs,
  updatedAt: new Date(0).toISOString()
};

const fallbackSnapshot: AppSnapshot = {
  config: fallbackConfig,
  history: []
};

export function App() {
  const bridgeAvailable = Boolean(window.image2tools);
  const params: ImageParams = DEFAULT_IMAGE_PARAMS;
  const sampleAssets: InputAsset[] = [];
  const validationMessage = getValidationError(params, "A clean product photo of a matte black travel mug");
  const customSizeStatus = validateGptImage2Size("2048x1152");
  const snapshot = fallbackSnapshot;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Image2Tools</p>
          <h1>GPT Image 2 Workbench</h1>
        </div>

        <section className="panel">
          <h2>Provider</h2>
          <label>
            API Key
            <input type="password" placeholder={snapshot.config.apiKeySaved ? "Saved" : "Paste API key"} />
          </label>
          <label>
            Base URL
            <input defaultValue={snapshot.config.baseURL} />
          </label>
          <button type="button">Test Connection</button>
        </section>

        <section className="panel">
          <h2>Parameters</h2>
          <div className="param-grid">
            <span>Model</span>
            <strong>{params.model}</strong>
            <span>Size</span>
            <strong>{params.size}</strong>
            <span>Quality</span>
            <strong>{params.quality}</strong>
            <span>Format</span>
            <strong>{params.outputFormat}</strong>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-header">
          <div>
            <p className="eyebrow">Generate / Edit / Inpaint</p>
            <h2>Prompt, references, output</h2>
          </div>
          <div className={bridgeAvailable ? "status ready" : "status"}>{bridgeAvailable ? "Electron ready" : "Browser preview"}</div>
        </div>

        <div className="canvas-zone">
          <div className="preview-frame">
            <div className="preview-empty">Result preview</div>
          </div>
        </div>

        <div className="prompt-row">
          <textarea defaultValue="A clean product photo of a matte black travel mug on a brushed steel counter" />
          <div className="actions">
            <button type="button">Generate</button>
            <button type="button">Edit</button>
          </div>
        </div>

        <div className="upload-row">
          <button type="button">Add Reference Images</button>
          <button type="button">Add Mask</button>
          <span>{sampleAssets.length} assets selected</span>
          <span>{validationMessage ?? customSizeStatus.message ?? "Ready"}</span>
        </div>
      </section>

      <aside className="history">
        <div>
          <p className="eyebrow">History</p>
          <h2>Recent jobs</h2>
        </div>
        <div className="history-empty">Generated and edited images will appear here with download controls.</div>
      </aside>
    </main>
  );
}
