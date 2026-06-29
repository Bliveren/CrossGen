import type { WorkMode } from "../shared/types";

export type Language = "en" | "zh";

interface ModeCopy {
  title: string;
  action: string;
  hint: string;
}

interface NoticeCopy {
  ready: string;
  browserPreview: string;
  jobStarted: string;
  partialReceived: (index: number | string) => string;
  imageCompleted: string;
  maskValidationFailed: string;
  draftRestored: (date: string) => string;
  draftCleared: string;
  bridgeSaveConfig: string;
  configSaved: string;
  bridgeTestConnection: string;
  bridgeClearKey: string;
  keyCleared: string;
  bridgeSelectImages: string;
  imagesAdded: (added: number, selected: number, capped: boolean, max: number) => string;
  bridgeSelectMask: string;
  maskAdded: string;
  bridgeRunJob: string;
  requestSent: (action: string) => string;
  actionFinished: (action: string) => string;
  savedTo: (filePath: string) => string;
  jobDeleted: string;
  historyCleared: string;
  promptCopied: string;
  clipboardUnavailable: string;
  jobLoaded: string;
  modelsDiscovered: (count: number) => string;
  launchSelected: (model: string) => string;
}

interface ValidationCopy {
  promptInvalid: string;
  promptRequired: string;
  promptTooLong: string;
  sizeInvalid: string;
  sizeFormat: string;
  sizeMultiple: string;
  sizeLongest: string;
  sizeRatio: string;
  sizePixels: string;
  addReference: string;
  addSource: string;
  maxInputs: (max: number) => string;
  paintOrUploadMask: string;
  generalProviderUnsupported: string;
  generalSelectImageModel: string;
  generalNoInpaint: string;
  generalNoMask: string;
  generalReferenceRequired: string;
  generalPromptOnly: string;
  cannotReadImage: string;
  maskFormatInvalid: string;
  maskSizeMismatch: string;
  cannotInspectMaskAlpha: string;
  maskEmpty: string;
  maskNeedsAlpha: string;
  maskLooksValid: string;
  regionGuideReady: string;
}

export interface UiCopy {
  language: string;
  english: string;
  chinese: string;
  tagline: string;
  provider: string;
  providerLabel: string;
  apiAccess: string;
  apiAccessName: string;
  apiAccessList: string;
  addApiAccess: string;
  addingApiAccess: string;
  switchApiAccess: string;
  deleteApiAccess: string;
  deleteLastApiAccessDisabled: string;
  confirmDeleteApiAccess: (name: string) => string;
  apiAccessAdded: string;
  apiAccessDeleted: string;
  apiAccessSwitched: (name: string) => string;
  apiAccessUntitled: string;
  apiAccessKind: string;
  apiAccessBaseURLSummary: string;
  providerAutoDetected: string;
  apiKey: string;
  baseURL: string;
  discoveryStatus: string;
  discoveryNotRun: string;
  discoveryLastRun: (date: string, count: number) => string;
  discoverModels: string;
  discoveringModels: string;
  discoveredModelsCount: (count: number) => string;
  connectionIdle: string;
  connectionChecking: string;
  connectionOk: string;
  connectionError: string;
  connectionErrorDetail: (message: string) => string;
  launchModels: string;
  launchAvailable: string;
  launchUnavailableNoKey: string;
  launchUnavailableNoDiscovery: string;
  launchUnavailableNoImageModels: string;
  launchUnavailableProvider: (provider: string) => string;
  launchUnavailableModel: (model: string) => string;
  launchRuntimeUnavailable: (model: string) => string;
  selectLaunchToRun: (model: string) => string;
  generalRuntimeUnsupported: string;
  generalLimitedRuntime: string;
  generalReferenceRuntime: string;
  generalPromptOnlyRuntime: string;
  generalFallback: string;
  savedLocally: string;
  pasteApiKey: string;
  save: string;
  test: string;
  clearKey: string;
  keySaved: string;
  noKeySaved: string;
  parameters: string;
  hide: string;
  show: string;
  size: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  format: string;
  custom: string;
  customSize: string;
  compression: string;
  pngIgnoresCompression: string;
  background: string;
  count: string;
  streamPartialPreview: string;
  streamSingleOutputOnly: string;
  partialImages: string;
  thinking: string;
  searchGrounding: string;
  moderation: string;
  timeoutSeconds: string;
  sizeValid: string;
  draft: string;
  autosaved: string;
  workspaceAutosaves: string;
  clearDraft: string;
  sync: string;
  preview: string;
  resultSuffix: string;
  resultViewer: string;
  outputCanvas: string;
  download: string;
  openFolder: string;
  saveImage: string;
  generatedResult: string;
  jobFailed: string;
  outputEmpty: string;
  prompt: string;
  running: string;
  copy: string;
  addReferences: string;
  uploadRightsReminder: string;
  uploadMask: string;
  clear: string;
  noReferences: string;
  dropReferencesHint: string;
  source: string;
  reference: string;
  mask: string;
  maskDescription: string;
  guidedRegionDescription: string;
  clearPaintedMask: string;
  sourceForMask: string;
  addSourceForMask: string;
  checkingMask: string;
  model: string;
  history: string;
  recentJobs: string;
  clearHistory: string;
  clearAllHistoryTooltip: string;
  confirmClearHistoryTitle: string;
  confirmClearHistoryBody: (count: number) => string;
  confirmClearHistory: string;
  cancel: string;
  searchPrompt: string;
  sortNewest: string;
  sortOldest: string;
  historyMatchCount: (count: number) => string;
  showAllHistory: (count: number) => string;
  collapseHistory: string;
  noJobsYet: string;
  openJob: string;
  historyResult: string;
  reuse: string;
  copyPrompt: string;
  delete: string;
  updates: string;
  currentVersion: string;
  checkUpdates: string;
  checkingUpdates: string;
  installUpdate: string;
  downloadingUpdate: string;
  updateNotConfigured: string;
  updateCurrent: string;
  updateAvailable: (version: string) => string;
  updateReady: (version: string) => string;
  updateCheckFailed: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  zoomLevel: string;
  clicked: string;
  modes: Record<WorkMode, ModeCopy>;
  guidedRegionMode: ModeCopy;
  tabs: { text2img: { title: string; hint: string }; img2img: { title: string; hint: string } };
  maskOptional: string;
  notices: NoticeCopy;
  validation: ValidationCopy;
}

export const translations: Record<Language, UiCopy> = {
  en: {
    language: "Language",
    english: "English",
    chinese: "中文",
    tagline: "An easy-to-use, all-in-one AI image generation management tool.",
    provider: "Model config",
    providerLabel: "Provider",
    apiAccess: "API access",
    apiAccessName: "Access name",
    apiAccessList: "Saved API access",
    addApiAccess: "Add API access",
    addingApiAccess: "Adding",
    switchApiAccess: "Switch API access",
    deleteApiAccess: "Delete API access",
    deleteLastApiAccessDisabled: "At least one API access must remain.",
    confirmDeleteApiAccess: (name: string) => `Delete API access "${name}"? Saved key and model discovery for this access will be removed.`,
    apiAccessAdded: "API access added.",
    apiAccessDeleted: "API access deleted.",
    apiAccessSwitched: (name: string) => `Switched to ${name}.`,
    apiAccessUntitled: "Untitled API access",
    apiAccessKind: "API type",
    apiAccessBaseURLSummary: "Base URL",
    providerAutoDetected: "Auto-detected from API",
    apiKey: "API Key",
    baseURL: "Base URL",
    discoveryStatus: "Model discovery",
    discoveryNotRun: "Not run",
    discoveryLastRun: (date: string, count: number) => `${date} · ${count} model${count === 1 ? "" : "s"}`,
    discoverModels: "Discover models",
    discoveringModels: "Discovering",
    discoveredModelsCount: (count: number) => `${count} model${count === 1 ? "" : "s"} discovered`,
    connectionIdle: "Not tested",
    connectionChecking: "Checking",
    connectionOk: "Connected",
    connectionError: "Connection issue",
    connectionErrorDetail: (message: string) => `Connection issue: ${message}. Check the API key, base URL, provider protocol, or network.`,
    launchModels: "Launch",
    launchAvailable: "Available",
    launchUnavailableNoKey: "Save an API key first.",
    launchUnavailableNoDiscovery: "Run model discovery first.",
    launchUnavailableNoImageModels: "No image models discovered.",
    launchUnavailableProvider: (provider: string) => `Switch to ${provider}.`,
    launchUnavailableModel: (model: string) => `${model} was not discovered.`,
    launchRuntimeUnavailable: (model: string) => `${model} runtime is not connected yet.`,
    selectLaunchToRun: (model: string) => `Select ${model} before running.`,
    generalRuntimeUnsupported: "General is not available for this provider.",
    generalLimitedRuntime: "General uses provider-specific minimal fallback capability.",
    generalReferenceRuntime: "General uses a minimal Gemini fallback: prompt and reference images only.",
    generalPromptOnlyRuntime: "General uses a minimal OpenAI-compatible fallback: prompt-only generation.",
    generalFallback: "Discovered fallback",
    savedLocally: "Saved locally",
    pasteApiKey: "Paste API key",
    save: "Save",
    test: "Test",
    clearKey: "Clear key",
    keySaved: "Key saved",
    noKeySaved: "No key saved",
    parameters: "Parameters",
    hide: "Hide",
    show: "Show",
    size: "Size",
    aspectRatio: "Aspect ratio",
    resolution: "Resolution",
    quality: "Quality",
    format: "Format",
    custom: "custom",
    customSize: "Custom size",
    compression: "Compression",
    pngIgnoresCompression: "PNG ignores compression",
    background: "Background",
    count: "Count",
    streamPartialPreview: "Stream partial preview",
    streamSingleOutputOnly: "Stream partial preview is available only when count is 1.",
    partialImages: "Partial images",
    thinking: "Thinking",
    searchGrounding: "Search grounding",
    moderation: "Moderation",
    timeoutSeconds: "Timeout seconds",
    sizeValid: "Size is valid for GPT Image 2.",
    draft: "Draft",
    autosaved: "Autosaved",
    workspaceAutosaves: "Workspace autosaves after edits.",
    clearDraft: "Clear draft",
    sync: "Sync",
    preview: "Preview",
    resultSuffix: "result",
    resultViewer: "Image preview",
    outputCanvas: "Output canvas",
    download: "Download",
    openFolder: "Open folder",
    saveImage: "Save image",
    generatedResult: "Generated result",
    jobFailed: "Job failed",
    outputEmpty: "Generated images and partial previews appear here.",
    prompt: "Prompt",
    running: "Running",
    copy: "Copy",
    addReferences: "Add references",
    uploadRightsReminder: "Only upload images you have permission to use; selected references are sent to the active image provider.",
    uploadMask: "Upload mask",
    clear: "Clear",
    noReferences: "No reference images selected.",
    dropReferencesHint: "No reference images. Drag images here, drag a history result, or use Add references.",
    source: "Source",
    reference: "Reference",
    mask: "Mask",
    maskDescription: "Paint the area to replace. With multiple references, the mask applies to the first image.",
    guidedRegionDescription: "Use the painted or uploaded region as guidance for the first image.",
    clearPaintedMask: "Clear painted mask",
    sourceForMask: "Source for mask",
    addSourceForMask: "Add a source image to paint a mask.",
    checkingMask: "Checking mask...",
    model: "Model",
    history: "History",
    recentJobs: "Recent jobs",
    clearHistory: "Clear history",
    clearAllHistoryTooltip: "Clear all history records",
    confirmClearHistoryTitle: "Clear all history?",
    confirmClearHistoryBody: (count: number) => `This will delete all ${count} history record${count === 1 ? "" : "s"} and managed result files.`,
    confirmClearHistory: "Clear all",
    cancel: "Cancel",
    searchPrompt: "Search prompt",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    historyMatchCount: (count: number) => `${count} match${count === 1 ? "" : "es"}`,
    showAllHistory: (count: number) => `Show all ${count}`,
    collapseHistory: "Show fewer",
    noJobsYet: "No jobs yet.",
    openJob: "Open job",
    historyResult: "History result",
    reuse: "Reuse",
    copyPrompt: "Copy prompt",
    delete: "Delete",
    updates: "Updates",
    currentVersion: "Current",
    checkUpdates: "Check",
    checkingUpdates: "Checking",
    installUpdate: "Update",
    downloadingUpdate: "Downloading",
    updateNotConfigured: "Update feed is not configured.",
    updateCurrent: "Up to date.",
    updateAvailable: (version: string) => `Version ${version} is available.`,
    updateReady: (version: string) => `Updater for ${version} opened. Local config and drafts remain in user data.`,
    updateCheckFailed: "Update check failed.",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    zoomLevel: "Zoom level",
    clicked: "Done",
    modes: {
      generate: { title: "Generate", action: "Generate", hint: "Prompt only" },
      edit: { title: "Edit", action: "Edit", hint: "Use references" },
      inpaint: { title: "Inpaint", action: "Inpaint", hint: "Source + mask" }
    },
    guidedRegionMode: { title: "Guided region", action: "Guide edit", hint: "Source + region" },
    tabs: {
      text2img: { title: "Text to image", hint: "Prompt only" },
      img2img: { title: "Image to image", hint: "References + optional mask" }
    },
    maskOptional: "(optional)",
    notices: {
      ready: "Ready.",
      browserPreview: "Browser preview: Electron IPC is unavailable.",
      jobStarted: "Job started.",
      partialReceived: (index: number | string) => `Partial image ${index} received.`,
      imageCompleted: "Image completed.",
      maskValidationFailed: "Mask validation failed.",
      draftRestored: (date: string) => `Draft restored from ${date}.`,
      draftCleared: "Draft cleared.",
      bridgeSaveConfig: "Electron bridge is required to save config.",
      configSaved: "Config saved locally.",
      bridgeTestConnection: "Electron bridge is required to test the API connection.",
      bridgeClearKey: "Electron bridge is required to clear the saved API key.",
      keyCleared: "Saved API key cleared.",
      bridgeSelectImages: "Electron bridge is required to select local image paths.",
      imagesAdded: (added: number, selected: number, capped: boolean, max: number) =>
        `${added} image${added === 1 ? "" : "s"} added, ${selected} selected.${capped ? ` GPT Image 2 accepts up to ${max} input images.` : ""}`,
      bridgeSelectMask: "Electron bridge is required to select a mask.",
      maskAdded: "Mask added.",
      bridgeRunJob: "Electron bridge is required to run image jobs.",
      requestSent: (action: string) => `${action} request sent.`,
      actionFinished: (action: string) => `${action} finished.`,
      savedTo: (filePath: string) => `Saved to ${filePath}`,
      jobDeleted: "Job deleted.",
      historyCleared: "History cleared.",
      promptCopied: "Prompt copied.",
      clipboardUnavailable: "Clipboard is unavailable.",
      jobLoaded: "Job loaded into workspace.",
      modelsDiscovered: (count: number) => `${count} model${count === 1 ? "" : "s"} discovered.`,
      launchSelected: (model: string) => `${model} selected.`
    },
    validation: {
      promptInvalid: "Prompt is invalid.",
      promptRequired: "Enter a prompt.",
      promptTooLong: "GPT Image prompts cannot exceed 32,000 characters.",
      sizeInvalid: "Size parameter is invalid.",
      sizeFormat: "Size must be auto or WIDTHxHEIGHT, for example 1536x1024.",
      sizeMultiple: "GPT Image 2 requires width and height to be multiples of 16.",
      sizeLongest: "GPT Image 2 maximum side length is 3840px.",
      sizeRatio: "GPT Image 2 aspect ratio cannot exceed 3:1.",
      sizePixels: "GPT Image 2 total pixels must be between 655,360 and 8,294,400.",
      addReference: "Add at least one reference image.",
      addSource: "Add a source image before inpainting.",
      maxInputs: (max: number) => `GPT Image 2 supports up to ${max} input images.`,
      paintOrUploadMask: "Paint or upload a mask before inpainting.",
      generalProviderUnsupported: "The current provider does not have a General runtime.",
      generalSelectImageModel: "Select an available image model.",
      generalNoInpaint: "General does not support inpainting in this version.",
      generalNoMask: "General does not support mask parameters in this version.",
      generalReferenceRequired: "Basic reference editing needs at least one reference image.",
      generalPromptOnly: "General OpenAI-compatible fallback only supports prompt-only generation.",
      cannotReadImage: "Cannot read image.",
      maskFormatInvalid: "Mask format is invalid.",
      maskSizeMismatch: "Mask size must match the first source image.",
      cannotInspectMaskAlpha: "Cannot inspect mask alpha.",
      maskEmpty: "Mask is empty.",
      maskNeedsAlpha: "Mask needs an alpha channel with transparent areas.",
      maskLooksValid: "Mask format, size, and alpha look valid.",
      regionGuideReady: "Region guide selected."
    }
  },
  zh: {
    language: "语言",
    english: "English",
    chinese: "中文",
    tagline: "方便易用的一站式AI生图管理工具。",
    provider: "模型配置",
    providerLabel: "服务商",
    apiAccess: "API 接入",
    apiAccessName: "接入名称",
    apiAccessList: "已保存 API 接入",
    addApiAccess: "添加 API 接入",
    addingApiAccess: "添加中",
    switchApiAccess: "切换 API 接入",
    deleteApiAccess: "删除 API 接入",
    deleteLastApiAccessDisabled: "至少需要保留一个 API 接入。",
    confirmDeleteApiAccess: (name: string) => `确认删除 API 接入“${name}”？该接入保存的 Key 和模型探测结果会一并移除。`,
    apiAccessAdded: "API 接入已添加。",
    apiAccessDeleted: "API 接入已删除。",
    apiAccessSwitched: (name: string) => `已切换到 ${name}。`,
    apiAccessUntitled: "未命名 API 接入",
    apiAccessKind: "API 类型",
    apiAccessBaseURLSummary: "Base URL",
    providerAutoDetected: "已根据 API 自动识别",
    apiKey: "API Key",
    baseURL: "Base URL",
    discoveryStatus: "模型探测",
    discoveryNotRun: "未探测",
    discoveryLastRun: (date: string, count: number) => `${date} · ${count} 个模型`,
    discoverModels: "探测模型",
    discoveringModels: "探测中",
    discoveredModelsCount: (count: number) => `探测到【${count}】个模型`,
    connectionIdle: "未测试",
    connectionChecking: "检测中",
    connectionOk: "连接成功",
    connectionError: "连接异常",
    connectionErrorDetail: (message: string) => `连接异常：${message}。请检查 API Key、Base URL、服务商协议或网络。`,
    launchModels: "启动模型",
    launchAvailable: "可用",
    launchUnavailableNoKey: "请先保存 API Key。",
    launchUnavailableNoDiscovery: "请先探测模型。",
    launchUnavailableNoImageModels: "未探测到图片模型。",
    launchUnavailableProvider: (provider: string) => `切换到 ${provider}。`,
    launchUnavailableModel: (model: string) => `未探测到 ${model}。`,
    launchRuntimeUnavailable: (model: string) => `${model} 运行时尚未接入。`,
    selectLaunchToRun: (model: string) => `运行前请选择 ${model}。`,
    generalRuntimeUnsupported: "当前 provider 暂未接入 General 运行时。",
    generalLimitedRuntime: "General 使用 provider 专属最小兜底能力。",
    generalReferenceRuntime: "General 使用最小 Gemini 兜底能力：仅提示词和参考图。",
    generalPromptOnlyRuntime: "General 使用最小 OpenAI 兼容兜底能力：仅纯提示词生成。",
    generalFallback: "探测到的兜底模型",
    savedLocally: "已本地保存",
    pasteApiKey: "粘贴 API Key",
    save: "保存",
    test: "测试",
    clearKey: "清除 Key",
    keySaved: "Key 已保存",
    noKeySaved: "未保存 Key",
    parameters: "参数配置",
    hide: "收起",
    show: "展开",
    size: "尺寸",
    aspectRatio: "画面比例",
    resolution: "分辨率",
    quality: "质量",
    format: "格式",
    custom: "自定义",
    customSize: "自定义尺寸",
    compression: "压缩",
    pngIgnoresCompression: "PNG 不使用压缩参数",
    background: "背景",
    count: "数量",
    streamPartialPreview: "流式局部预览",
    streamSingleOutputOnly: "流式局部预览仅支持数量为 1 时使用。",
    partialImages: "局部预览数",
    thinking: "Thinking",
    searchGrounding: "联网搜索 grounding",
    moderation: "内容审核",
    timeoutSeconds: "超时秒数",
    sizeValid: "尺寸符合 GPT Image 2 要求。",
    draft: "草稿",
    autosaved: "已自动保存",
    workspaceAutosaves: "编辑后会自动保存工作区。",
    clearDraft: "清除草稿",
    sync: "同步",
    preview: "预览",
    resultSuffix: "结果",
    resultViewer: "图片预览",
    outputCanvas: "输出画布",
    download: "下载",
    openFolder: "打开文件夹",
    saveImage: "保存图片",
    generatedResult: "生成结果",
    jobFailed: "任务失败",
    outputEmpty: "生成图片和局部预览会显示在这里。",
    prompt: "提示词",
    running: "运行中",
    copy: "复制",
    addReferences: "添加参考图",
    uploadRightsReminder: "仅上传你有权使用的图片；已选择的参考图会发送给当前图片服务商。",
    uploadMask: "上传蒙版",
    clear: "清除",
    noReferences: "未选择参考图。",
    dropReferencesHint: "暂无参考图。可拖拽图片到此处、拖入历史结果，或点击「添加参考图」。",
    source: "源图",
    reference: "参考图",
    mask: "蒙版",
    maskDescription: "涂抹需要替换的区域。多张参考图时，蒙版应用到第一张图片。",
    guidedRegionDescription: "将涂抹或上传的区域作为第一张图片的修改引导。",
    clearPaintedMask: "清除已绘制蒙版",
    sourceForMask: "蒙版源图",
    addSourceForMask: "添加源图后可绘制蒙版。",
    checkingMask: "正在检查蒙版...",
    model: "模型",
    history: "历史",
    recentJobs: "最近任务",
    clearHistory: "清空历史",
    clearAllHistoryTooltip: "清空全部历史记录",
    confirmClearHistoryTitle: "确认清空全部历史？",
    confirmClearHistoryBody: (count: number) => `将删除全部 ${count} 条历史记录及其托管结果文件。`,
    confirmClearHistory: "确认清空",
    cancel: "取消",
    searchPrompt: "搜索提示词",
    sortNewest: "最新优先",
    sortOldest: "最早优先",
    historyMatchCount: (count: number) => `${count} 条匹配`,
    showAllHistory: (count: number) => `显示全部 ${count} 条`,
    collapseHistory: "收起",
    noJobsYet: "暂无任务。",
    openJob: "打开任务",
    historyResult: "历史结果",
    reuse: "复用",
    copyPrompt: "复制提示词",
    delete: "删除",
    updates: "升级",
    currentVersion: "当前版本",
    checkUpdates: "检查",
    checkingUpdates: "检查中",
    installUpdate: "更新",
    downloadingUpdate: "下载中",
    updateNotConfigured: "未配置升级地址。",
    updateCurrent: "已是最新版本。",
    updateAvailable: (version: string) => `发现新版本 ${version}。`,
    updateReady: (version: string) => `${version} 更新程序已启动。本地配置和草稿会保留。`,
    updateCheckFailed: "检查更新失败。",
    zoomIn: "放大",
    zoomOut: "缩小",
    resetZoom: "重置缩放",
    zoomLevel: "缩放比例",
    clicked: "完成",
    modes: {
      generate: { title: "生成", action: "生成", hint: "仅提示词" },
      edit: { title: "编辑", action: "编辑", hint: "使用参考图" },
      inpaint: { title: "局部重绘", action: "局部重绘", hint: "源图 + 蒙版" }
    },
    guidedRegionMode: { title: "区域引导", action: "区域引导", hint: "源图 + 区域" },
    tabs: {
      text2img: { title: "文生图", hint: "仅提示词" },
      img2img: { title: "图生图", hint: "参考图 + 可选蒙版" }
    },
    maskOptional: "（可选）",
    notices: {
      ready: "就绪。",
      browserPreview: "浏览器预览：Electron IPC 不可用。",
      jobStarted: "任务已开始。",
      partialReceived: (index: number | string) => `收到局部预览 ${index}。`,
      imageCompleted: "图片已完成。",
      maskValidationFailed: "蒙版校验失败。",
      draftRestored: (date: string) => `已恢复 ${date} 的草稿。`,
      draftCleared: "草稿已清除。",
      bridgeSaveConfig: "需要 Electron bridge 才能保存配置。",
      configSaved: "配置已保存到本地。",
      bridgeTestConnection: "需要 Electron bridge 才能测试 API 连接。",
      bridgeClearKey: "需要 Electron bridge 才能清除已保存的 API Key。",
      keyCleared: "已清除保存的 API Key。",
      bridgeSelectImages: "需要 Electron bridge 才能选择本地图片。",
      imagesAdded: (added: number, selected: number, capped: boolean, max: number) =>
        `已添加 ${added} 张图片，当前选择 ${selected} 张。${capped ? ` GPT Image 2 最多支持 ${max} 张输入图片。` : ""}`,
      bridgeSelectMask: "需要 Electron bridge 才能选择蒙版。",
      maskAdded: "蒙版已添加。",
      bridgeRunJob: "需要 Electron bridge 才能运行图片任务。",
      requestSent: (action: string) => `${action}请求已发送。`,
      actionFinished: (action: string) => `${action}已完成。`,
      savedTo: (filePath: string) => `已保存到 ${filePath}`,
      jobDeleted: "任务已删除。",
      historyCleared: "历史已清空。",
      promptCopied: "提示词已复制。",
      clipboardUnavailable: "剪贴板不可用。",
      jobLoaded: "任务已载入工作区。",
      modelsDiscovered: (count: number) => `已探测到 ${count} 个模型。`,
      launchSelected: (model: string) => `已选择 ${model}。`
    },
    validation: {
      promptInvalid: "Prompt 格式无效。",
      promptRequired: "请输入提示词。",
      promptTooLong: "GPT Image prompt 不能超过 32000 字符。",
      sizeInvalid: "尺寸参数无效。",
      sizeFormat: "尺寸需使用 auto 或 WIDTHxHEIGHT，例如 1536x1024。",
      sizeMultiple: "GPT Image 2 要求宽高都是 16 的倍数。",
      sizeLongest: "GPT Image 2 最长边不能超过 3840px。",
      sizeRatio: "GPT Image 2 长短边比例不能超过 3:1。",
      sizePixels: "GPT Image 2 总像素需在 655,360 到 8,294,400 之间。",
      addReference: "请至少添加一张参考图。",
      addSource: "局部重绘前请先添加源图。",
      maxInputs: (max: number) => `GPT Image 2 最多支持 ${max} 张输入图片。`,
      paintOrUploadMask: "局部重绘前请绘制或上传蒙版。",
      generalProviderUnsupported: "当前 provider 暂未接入 General 运行时。",
      generalSelectImageModel: "请选择可用的图片模型。",
      generalNoInpaint: "General 首期不支持局部重绘。",
      generalNoMask: "General 首期不支持 mask 参数。",
      generalReferenceRequired: "基础参考图编辑至少需要一张参考图。",
      generalPromptOnly: "General OpenAI 兼容兜底仅支持纯提示词生成。",
      cannotReadImage: "无法读取图片。",
      maskFormatInvalid: "蒙版格式无效。",
      maskSizeMismatch: "蒙版尺寸必须与第一张源图一致。",
      cannotInspectMaskAlpha: "无法检查蒙版透明通道。",
      maskEmpty: "蒙版为空。",
      maskNeedsAlpha: "蒙版需要带透明区域的 alpha 通道。",
      maskLooksValid: "蒙版格式、尺寸和透明通道有效。",
      regionGuideReady: "已选择区域引导。"
    }
  }
};

const validationMessageMap: Record<string, keyof UiCopy["validation"]> = {
  "Prompt 格式无效。": "promptInvalid",
  "请输入 prompt。": "promptRequired",
  "GPT Image prompt 不能超过 32000 字符。": "promptTooLong",
  "尺寸参数无效。": "sizeInvalid",
  "尺寸需使用 auto 或 WIDTHxHEIGHT，例如 1536x1024。": "sizeFormat",
  "GPT Image 2 要求宽高都是 16 的倍数。": "sizeMultiple",
  "GPT Image 2 最长边不能超过 3840px。": "sizeLongest",
  "GPT Image 2 长短边比例不能超过 3:1。": "sizeRatio",
  "GPT Image 2 总像素需在 655,360 到 8,294,400 之间。": "sizePixels",
  "当前 provider 暂未接入 General 运行时。": "generalProviderUnsupported",
  "请选择可用的图片模型。": "generalSelectImageModel",
  "General 首期不支持局部重绘。": "generalNoInpaint",
  "General 首期不支持 mask 参数。": "generalNoMask",
  "基础参考图编辑至少需要一张参考图。": "generalReferenceRequired",
  "General OpenAI 兼容兜底仅支持纯提示词生成。": "generalPromptOnly",
  "Paint or upload a mask before inpaint.": "paintOrUploadMask",
  "Mask format is invalid.": "maskFormatInvalid",
  "Mask must be PNG or WebP with alpha.": "maskFormatInvalid",
  "Mask-based inpaint requires the first source image to be PNG or WebP.": "maskFormatInvalid",
  "Mask format must match the first source image.": "maskSizeMismatch",
  "Mask size must match the first source image.": "maskSizeMismatch",
  "Cannot inspect mask alpha.": "cannotInspectMaskAlpha",
  "Mask is empty.": "maskEmpty",
  "Mask needs an alpha channel with transparent areas.": "maskNeedsAlpha",
  "Mask format, size, and alpha look valid.": "maskLooksValid"
};

export function getInitialLanguage(): Language {
  const saved = window.localStorage.getItem("image2tools.language");
  if (saved === "en" || saved === "zh") return saved;
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function localizeValidationMessage(message: string | null | undefined, copy: UiCopy): string | null {
  if (!message) return null;
  const key = validationMessageMap[message];
  const localized = key ? copy.validation[key] : undefined;
  return typeof localized === "string" ? localized : message;
}
