import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppBridge,
  DownloadRequest,
  JobProgressEvent,
  PromptTemplateInput,
  ProviderConfigInput,
  RunJobRequest,
  WorkspaceDraftInput
} from "../shared/types.js";

const bridge: AppBridge = {
  getSnapshot: () => ipcRenderer.invoke("app:getSnapshot"),
  saveConfig: (input: ProviderConfigInput) => ipcRenderer.invoke("config:save", input),
  addProvider: (input: ProviderConfigInput) => ipcRenderer.invoke("provider:add", input),
  switchProvider: (providerId: string) => ipcRenderer.invoke("provider:switch", providerId),
  deleteProvider: (providerId: string) => ipcRenderer.invoke("provider:delete", providerId),
  discoverModels: () => ipcRenderer.invoke("config:discoverModels"),
  clearApiKey: () => ipcRenderer.invoke("config:clearApiKey"),
  testConnection: () => ipcRenderer.invoke("config:testConnection"),
  saveDraft: (input: WorkspaceDraftInput) => ipcRenderer.invoke("draft:save", input),
  clearDraft: () => ipcRenderer.invoke("draft:clear"),
  listTemplates: () => ipcRenderer.invoke("templates:list"),
  saveTemplate: (input: PromptTemplateInput, templateId?: string) => ipcRenderer.invoke("templates:save", input, templateId),
  deleteTemplate: (id: string) => ipcRenderer.invoke("templates:delete", id),
  importTemplates: () => ipcRenderer.invoke("templates:import"),
  exportTemplates: (templateIds?: string[]) => ipcRenderer.invoke("templates:export", templateIds),
  listGallery: () => ipcRenderer.invoke("gallery:list"),
  importToGallery: (paths?: string[]) => ipcRenderer.invoke("gallery:import", paths),
  addHistoryAssetToGallery: (assetPath: string) => ipcRenderer.invoke("gallery:addHistoryAsset", assetPath),
  updateGalleryAsset: (id: string, patch: { tags?: string[] }) => ipcRenderer.invoke("gallery:update", id, patch),
  removeGalleryAsset: (id: string) => ipcRenderer.invoke("gallery:remove", id),
  pickGalleryAsset: (id: string) => ipcRenderer.invoke("gallery:pick", id),
  selectImages: () => ipcRenderer.invoke("dialog:selectImages"),
  getDroppedFilePaths: (files: File[]) => files.map((file) => webUtils.getPathForFile(file)),
  importImages: (paths: string[]) => ipcRenderer.invoke("dialog:importImages", paths),
  selectMask: () => ipcRenderer.invoke("dialog:selectMask"),
  runJob: (request: RunJobRequest) => ipcRenderer.invoke("job:run", request),
  downloadAsset: (request: DownloadRequest) => ipcRenderer.invoke("asset:download", request),
  openAssetFolder: (assetPath: string) => ipcRenderer.invoke("asset:openFolder", assetPath),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("updates:downloadAndInstall"),
  deleteJob: (jobId: string) => ipcRenderer.invoke("history:deleteJob", jobId),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  onJobEvent: (callback: (event: JobProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: JobProgressEvent) => callback(payload);
    ipcRenderer.on("job:event", handler);
    return () => ipcRenderer.off("job:event", handler);
  }
};

contextBridge.exposeInMainWorld("image2tools", bridge);
