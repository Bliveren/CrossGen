import { contextBridge, ipcRenderer } from "electron";
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
  testConnection: () => ipcRenderer.invoke("config:testConnection"),
  saveDraft: (input: WorkspaceDraftInput) => ipcRenderer.invoke("draft:save", input),
  clearDraft: () => ipcRenderer.invoke("draft:clear"),
  selectImages: () => ipcRenderer.invoke("dialog:selectImages"),
  selectMask: () => ipcRenderer.invoke("dialog:selectMask"),
  runJob: (request: RunJobRequest) => ipcRenderer.invoke("job:run", request),
  downloadAsset: (request: DownloadRequest) => ipcRenderer.invoke("asset:download", request),
  openAssetFolder: (assetPath: string) => ipcRenderer.invoke("asset:openFolder", assetPath),
  deleteJob: (jobId: string) => ipcRenderer.invoke("history:deleteJob", jobId),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  onJobEvent: (callback: (event: JobProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: JobProgressEvent) => callback(payload);
    ipcRenderer.on("job:event", handler);
    return () => ipcRenderer.off("job:event", handler);
  }
};

contextBridge.exposeInMainWorld("image2tools", bridge);
