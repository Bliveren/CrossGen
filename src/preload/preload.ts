import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppBridge,
  DownloadRequest,
  JobProgressEvent,
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
