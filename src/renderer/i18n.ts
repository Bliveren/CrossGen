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
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  english: string;
  chinese: string;
  tagline: string;
  provider: string;
  providerLabel: string;
  apiAccess: string;
  apiAccessShort: string;
  apiAccessName: string;
  apiAccessList: string;
  apiAccessCurrentSlot: string;
  apiAccessDialogSummary: (count: number) => string;
  apiAccessEditHint: string;
  apiAccessUseNow: string;
  apiAccessSelectedDetail: string;
  apiAccessModels: string;
  apiAccessNoModels: string;
  apiAccessSaved: string;
  addApiAccess: string;
  addingApiAccess: string;
  switchApiAccess: string;
  currentApiAccess: string;
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
  promptTemplates: string;
  promptTemplatesDescription: string;
  templateTitle: string;
  templateBody: string;
  templateTags: string;
  templateCategory: string;
  templateSearch: string;
  templateAllTags: string;
  templateNew: string;
  templateSave: string;
  templateUpdate: string;
  templateEdit: string;
  templateUse: string;
  templateImport: string;
  templateExport: string;
  templateEmpty: string;
  templateNoMatch: string;
  templateDeleteConfirm: (title: string) => string;
  templateSaved: string;
  templateDeleted: string;
  templateApplied: (title: string) => string;
  templateImported: (imported: number, skipped: number) => string;
  templateExported: (filePath: string) => string;
  library: string;
  libraryConfig: string;
  batchSelect: string;
  exitBatchSelect: string;
  gallery: string;
  galleryDescription: string;
  galleryFolders: string;
  galleryFolderCompactLabel: string;
  galleryAllFolders: string;
  galleryUncategorized: string;
  galleryFolderFilter: string;
  galleryTagFilter: string;
  galleryTagCompactLabel: string;
  galleryFolderNew: string;
  galleryFolderName: string;
  galleryFolderCreate: string;
  galleryFolderRename: string;
  galleryFolderDelete: string;
  galleryFolderContents: string;
  galleryViewMode: string;
  galleryGridView: string;
  galleryListView: string;
  gallerySelectItem: (name: string) => string;
  galleryOpenItem: (name: string) => string;
  galleryFolderItemMeta: (count: number, modifiedAt: string) => string;
  galleryFolderDialogDescription: string;
  galleryFolderDeleteConfirm: (name: string) => string;
  galleryFolderCreated: string;
  galleryFolderRenamed: string;
  galleryFolderMoved: string;
  galleryFolderMoveInvalid: string;
  galleryFolderDeleted: string;
  galleryFolderNameExists: string;
  gallerySelectionCount: (count: number) => string;
  galleryClearSelection: string;
  galleryDeleteSelected: string;
  galleryDeleteSelectedTooltip: (count: number) => string;
  gallerySelectedDeleteConfirm: (count: number) => string;
  gallerySelectedDeleted: string;
  clearGalleryTooltip: string;
  confirmClearGalleryTitle: string;
  confirmClearGalleryBody: (assetCount: number, folderCount: number) => string;
  confirmClearGallery: string;
  galleryCleared: string;
  galleryMoveToFolder: string;
  galleryMoved: string;
  gallerySearch: string;
  galleryAllTags: string;
  galleryImport: string;
  importShort: string;
  galleryChoose: string;
  galleryAssetRename: string;
  galleryAssetName: string;
  galleryAssetRenamed: string;
  galleryAddHistory: string;
  galleryAddTargetFolder: string;
  galleryOpenedForPreview: (name: string) => string;
  galleryAlreadyInGallery: string;
  gallerySaveEditedTitle: string;
  gallerySaveEditedBody: (name: string) => string;
  galleryOverwrite: string;
  gallerySaveAsCopy: string;
  galleryReplaced: string;
  gallerySavedAsCopy: string;
  galleryEditTags: string;
  gallerySaveTags: string;
  galleryAddCanceled: string;
  galleryImportCanceled: string;
  copyImagePath: string;
  imagePathCopied: string;
  tagManager: string;
  tagManagerDescription: string;
  tagRename: string;
  tagDelete: string;
  tagRenamed: string;
  tagDeleted: string;
  batchAddTags: string;
  newTagPlaceholder: string;
  addTag: string;
  noTagsYet: string;
  batchTagsUpdated: string;
  galleryEmpty: string;
  galleryNoMatch: string;
  galleryDeleteConfirm: (name: string) => string;
  galleryImported: (count: number) => string;
  galleryAdded: string;
  galleryPicked: (name: string) => string;
  galleryUpdated: string;
  galleryDeleted: string;
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
  streamPartialPreviewUnavailable: string;
  streamPartialPreviewGenerateOnly: string;
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
  saveImage: string;
  generatedResult: string;
  jobFailed: string;
  outputEmpty: string;
  generatingElapsed: (seconds: number) => string;
  prompt: string;
  running: string;
  copy: string;
  addReferences: string;
  addLocalReferences: string;
  referenceLimitReached: (max: number) => string;
  uploadRightsReminder: string;
  uploadMask: string;
  uploadMaskTooltip: string;
  addPaintedMask: string;
  addPaintedMaskTooltip: string;
  clear: string;
  noReferences: string;
  dropReferencesHint: string;
  source: string;
  reference: string;
  mask: string;
  maskDescription: string;
  guidedRegionDescription: string;
  maskBrushSize: string;
  clearPaintedMask: string;
  sourceForMask: string;
  addSourceForMask: string;
  checkingMask: string;
  model: string;
  history: string;
  recentJobs: string;
  recentJobsDescription: string;
  clearHistory: string;
  clearAllHistoryTooltip: string;
  confirmClearHistoryTitle: string;
  confirmClearHistoryBody: (count: number) => string;
  confirmClearHistory: string;
  cancel: string;
  searchPrompt: string;
  historyFilter: string;
  filterAll: string;
  historySucceeded: string;
  historyFailed: string;
  sortNewest: string;
  sortOldest: string;
  sortName: string;
  sortSize: string;
  sortModified: string;
  historyMatchCount: (count: number) => string;
  showAllHistory: (count: number) => string;
  collapseHistory: string;
  historyGridView: string;
  historyListView: string;
  historySelectItem: (name: string) => string;
  historySelectionCount: (count: number) => string;
  historyDeleteSelected: string;
  historyDeleteSelectedTooltip: (count: number) => string;
  historySelectedDeleteConfirm: (count: number) => string;
  historySelectedDeleted: (count: number) => string;
  historyTagsUpdated: string;
  historyRenamed: string;
  historyEditName: string;
  historyEditTags: string;
  historySaveName: string;
  historySaveTags: string;
  historySystemTag: string;
  historyImageName: string;
  historyDuration: (duration: string) => string;
  historyPageSizeMenu: string;
  historyPageSizeOption: (count: number) => string;
  noJobsYet: string;
  openJob: string;
  historyResult: string;
  reuse: string;
  copyPrompt: string;
  removePromptChip: string;
  delete: string;
  openFolder: string;
  openHistoryFolder: string;
  chooseHistoryFolder: string;
  openGalleryFolder: string;
  chooseGalleryFolder: string;
  chooseStorageFolder: string;
  historyStats: (count: number) => string;
  galleryStats: (assetCount: number, folderCount: number) => string;
  historyStorageUpdated: string;
  galleryStorageUpdated: string;
  storageFoldersUpdated: string;
  storageFolderDialogDescription: string;
  storageFolderSyncBoth: string;
  storageSharedPath: string;
  updates: string;
  currentVersion: string;
  checkUpdates: string;
  checkLatestVersion: string;
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
  back: string;
  editImage: string;
  cropImage: string;
  drawTool: string;
  textTool: string;
  textBox: string;
  quickColors: string;
  chooseColor: (color: string) => string;
  annotationColor: string;
  currentAnnotationColor: (color: string) => string;
  eyedropperTool: string;
  eyedropperActive: string;
  annotationColorPicked: (color: string) => string;
  annotationColorPickFailed: string;
  strokeWidth: string;
  textSize: string;
  boldText: string;
  undo: string;
  clearAnnotations: string;
  saveToGallery: string;
  saveCropSelectionToGallery: string;
  downloadEditedImage: string;
  editedDownloadStarted: string;
  annotationRestoreFailed: string;
  cropRectangle: string;
  cropEllipse: string;
  applyCrop: string;
  cropApplied: string;
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
    theme: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    english: "English",
    chinese: "中文",
    tagline: "An easy-to-use, all-in-one AI image generation management tool.",
    provider: "API config",
    providerLabel: "API type",
    apiAccess: "API config",
    apiAccessShort: "Config",
    apiAccessName: "API config name",
    apiAccessList: "Saved API configs",
    apiAccessCurrentSlot: "Current in use",
    apiAccessDialogSummary: (count: number) => `${count} saved config${count === 1 ? "" : "s"} · Click a card to edit it.`,
    apiAccessEditHint: "Click a card to edit it on the right.",
    apiAccessUseNow: "Use this config now",
    apiAccessSelectedDetail: "Config details",
    apiAccessModels: "Supported models",
    apiAccessNoModels: "No models discovered yet.",
    apiAccessSaved: "Saved",
    addApiAccess: "Add API config",
    addingApiAccess: "Adding",
    switchApiAccess: "Use this API config",
    currentApiAccess: "Current API config",
    deleteApiAccess: "Delete API config",
    deleteLastApiAccessDisabled: "At least one API config must remain.",
    confirmDeleteApiAccess: (name: string) => `Delete API config "${name}"? Saved key and model discovery for this config will be removed.`,
    apiAccessAdded: "API config added.",
    apiAccessDeleted: "API config deleted.",
    apiAccessSwitched: (name: string) => `Switched to ${name}.`,
    apiAccessUntitled: "Untitled API config",
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
    connectionErrorDetail: (message: string) => `Connection issue: ${message}. Check the API key, base URL, API protocol, or network.`,
    launchModels: "Launch",
    launchAvailable: "Available",
    launchUnavailableNoKey: "Save an API key first.",
    launchUnavailableNoDiscovery: "Run model discovery first.",
    launchUnavailableNoImageModels: "No image models discovered.",
    launchUnavailableProvider: (provider: string) => `Switch to ${provider}.`,
    launchUnavailableModel: (model: string) => `${model} was not discovered.`,
    launchRuntimeUnavailable: (model: string) => `${model} runtime is not connected yet.`,
    selectLaunchToRun: (model: string) => `Select ${model} before running.`,
    generalRuntimeUnsupported: "General is not available for this API config.",
    generalLimitedRuntime: "General uses API-specific minimal fallback capability.",
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
    promptTemplates: "Prompt templates",
    promptTemplatesDescription: "Save and reuse prompt presets.",
    templateTitle: "Title",
    templateBody: "Template prompt",
    templateTags: "Tags",
    templateCategory: "Category",
    templateSearch: "Search templates",
    templateAllTags: "All",
    templateNew: "New template",
    templateSave: "Save template",
    templateUpdate: "Update template",
    templateEdit: "Edit template",
    templateUse: "Use template",
    templateImport: "Import templates",
    templateExport: "Export templates",
    templateEmpty: "No templates yet.",
    templateNoMatch: "No matching templates.",
    templateDeleteConfirm: (title: string) => `Delete template "${title}"?`,
    templateSaved: "Template saved.",
    templateDeleted: "Template deleted.",
    templateApplied: (title: string) => `Template "${title}" filled into the prompt.`,
    templateImported: (imported: number, skipped: number) => `${imported} template${imported === 1 ? "" : "s"} imported${skipped ? `, ${skipped} skipped` : ""}.`,
    templateExported: (filePath: string) => `Templates exported to ${filePath}`,
    library: "Library",
    libraryConfig: "Library path settings",
    batchSelect: "Batch select",
    exitBatchSelect: "Exit batch select",
    gallery: "Gallery",
    galleryDescription: "Reference images ready for reuse.",
    galleryFolders: "Gallery folders",
    galleryFolderCompactLabel: "Folders",
    galleryAllFolders: "All",
    galleryUncategorized: "Unsorted",
    galleryFolderFilter: "Gallery folder filter",
    galleryTagFilter: "Gallery tag filter",
    galleryTagCompactLabel: "Tags",
    galleryFolderNew: "New folder",
    galleryFolderName: "Folder name",
    galleryFolderCreate: "Create folder",
    galleryFolderRename: "Rename folder",
    galleryFolderDelete: "Delete folder",
    galleryFolderContents: "Gallery folder contents",
    galleryViewMode: "Gallery view mode",
    galleryGridView: "Grid view",
    galleryListView: "List view",
    gallerySelectItem: (name: string) => `Select ${name}`,
    galleryOpenItem: (name: string) => `Open ${name}`,
    galleryFolderItemMeta: (count: number, modifiedAt: string) => `${count} image${count === 1 ? "" : "s"} · ${modifiedAt}`,
    galleryFolderDialogDescription: "Folders map to local folders in your Gallery storage path.",
    galleryFolderDeleteConfirm: (name: string) => `Delete Gallery folder "${name}"? Images stay in Gallery and move to Unsorted.`,
    galleryFolderCreated: "Gallery folder created.",
    galleryFolderRenamed: "Gallery folder renamed.",
    galleryFolderMoved: "Gallery folder moved.",
    galleryFolderMoveInvalid: "A folder cannot be moved into itself or one of its child folders.",
    galleryFolderDeleted: "Gallery folder deleted.",
    galleryFolderNameExists: "A Gallery folder with this name already exists.",
    gallerySelectionCount: (count: number) => `${count} selected`,
    galleryClearSelection: "Clear selection",
    galleryDeleteSelected: "Delete selected",
    galleryDeleteSelectedTooltip: (count: number) => count > 0 ? `Delete ${count} selected Gallery item${count === 1 ? "" : "s"}` : "Select Gallery items to delete",
    gallerySelectedDeleteConfirm: (count: number) => `Delete ${count} selected Gallery item${count === 1 ? "" : "s"}?`,
    gallerySelectedDeleted: "Selected Gallery items deleted.",
    clearGalleryTooltip: "Clear all Gallery items",
    confirmClearGalleryTitle: "Clear Gallery?",
    confirmClearGalleryBody: (assetCount: number, folderCount: number) => `This will delete ${assetCount} Gallery image${assetCount === 1 ? "" : "s"} and ${folderCount} folder${folderCount === 1 ? "" : "s"}.`,
    confirmClearGallery: "Clear Gallery",
    galleryCleared: "Gallery images cleared.",
    galleryMoveToFolder: "Move to folder",
    galleryMoved: "Gallery image moved.",
    gallerySearch: "Search Gallery",
    galleryAllTags: "All",
    galleryImport: "Import to Gallery",
    importShort: "Import",
    galleryChoose: "Choose from Gallery",
    galleryAssetRename: "Rename image",
    galleryAssetName: "Image name",
    galleryAssetRenamed: "Gallery image renamed.",
    galleryAddHistory: "Add to Gallery",
    galleryAddTargetFolder: "Gallery target folder",
    galleryOpenedForPreview: (name: string) => `${name} opened in the editor.`,
    galleryAlreadyInGallery: "This image is already in Gallery.",
    gallerySaveEditedTitle: "Save edited Gallery image",
    gallerySaveEditedBody: (name: string) => `Overwrite "${name}" or save the edit as a new Gallery image?`,
    galleryOverwrite: "Overwrite",
    gallerySaveAsCopy: "Save as copy",
    galleryReplaced: "Gallery image overwritten.",
    gallerySavedAsCopy: "Saved as a new Gallery image.",
    galleryEditTags: "Edit tags",
    gallerySaveTags: "Save tags",
    galleryAddCanceled: "Gallery add canceled.",
    galleryImportCanceled: "Gallery import canceled.",
    copyImagePath: "Copy image path",
    imagePathCopied: "Image path copied.",
    tagManager: "Manage tags",
    tagManagerDescription: "Rename or delete tags across History and Gallery.",
    tagRename: "Rename tag",
    tagDelete: "Delete tag",
    tagRenamed: "Tag renamed.",
    tagDeleted: "Tag deleted.",
    batchAddTags: "Add tag to selected",
    newTagPlaceholder: "New tag",
    addTag: "Add tag",
    noTagsYet: "No tags yet",
    batchTagsUpdated: "Selected tags updated.",
    galleryEmpty: "No Gallery images yet.",
    galleryNoMatch: "No matching Gallery images.",
    galleryDeleteConfirm: (name: string) => `Delete Gallery image "${name}"?`,
    galleryImported: (count: number) => `${count} image${count === 1 ? "" : "s"} imported to Gallery.`,
    galleryAdded: "Added to Gallery.",
    galleryPicked: (name: string) => `${name} added as a reference.`,
    galleryUpdated: "Gallery tags updated.",
    galleryDeleted: "Gallery image deleted.",
    galleryStorageUpdated: "Gallery storage folder updated.",
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
    streamPartialPreviewUnavailable: "Stream partial preview is available only for GPT Image 2 text-to-image generation.",
    streamPartialPreviewGenerateOnly: "Stream partial preview is available only for text-to-image generation.",
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
    saveImage: "Save image",
    generatedResult: "Generated result",
    jobFailed: "Job failed",
    outputEmpty: "Generated images and partial previews appear here.",
    generatingElapsed: (seconds: number) => `Generating image, elapsed ${seconds} seconds`,
    prompt: "Prompt",
    running: "Running",
    copy: "Copy",
    addReferences: "Add references",
    addLocalReferences: "Add local reference image",
    referenceLimitReached: (max: number) => `The current model supports up to ${max} reference image${max === 1 ? "" : "s"}.`,
    uploadRightsReminder: "Only upload images you have permission to use; selected references are sent to the active image provider.",
    uploadMask: "Upload mask",
    uploadMaskTooltip: "Upload an existing mask image.",
    addPaintedMask: "Add as mask",
    addPaintedMaskTooltip: "Add the painted region as the active mask.",
    clear: "Clear",
    noReferences: "No reference images selected.",
    dropReferencesHint: "Drag local images, History results, or Gallery images here.",
    source: "Source",
    reference: "Reference",
    mask: "Mask",
    maskDescription: "Paint the area to replace. With multiple references, the mask applies to the first image.",
    guidedRegionDescription: "Use the painted region as guidance for the first image.",
    maskBrushSize: "Adjust mask brush size",
    clearPaintedMask: "Clear painted mask",
    sourceForMask: "Source for mask",
    addSourceForMask: "Add a source image to paint a mask.",
    checkingMask: "Checking mask...",
    model: "Model",
    history: "History",
    recentJobs: "Recent jobs",
    recentJobsDescription: "Latest generated tasks and reusable outputs.",
    clearHistory: "Clear history",
    clearAllHistoryTooltip: "Clear all history records",
    confirmClearHistoryTitle: "Clear all history?",
    confirmClearHistoryBody: (count: number) => `This will delete all ${count} history record${count === 1 ? "" : "s"} and managed result files.`,
    confirmClearHistory: "Clear all",
    cancel: "Cancel",
    searchPrompt: "Search prompt",
    historyFilter: "History filter",
    filterAll: "All",
    historySucceeded: "Succeeded",
    historyFailed: "Failed",
    sortNewest: "Newest",
    sortOldest: "Oldest",
    sortName: "Name",
    sortSize: "Size",
    sortModified: "Modified",
    historyMatchCount: (count: number) => `${count} match${count === 1 ? "" : "es"}`,
    showAllHistory: () => "Show all",
    collapseHistory: "Show fewer",
    historyGridView: "Grid view",
    historyListView: "List view",
    historySelectItem: (name: string) => `Select history item ${name}`,
    historySelectionCount: (count: number) => `${count} selected`,
    historyDeleteSelected: "Delete selected history",
    historyDeleteSelectedTooltip: (count: number) => count > 0 ? `Delete ${count} selected history item${count === 1 ? "" : "s"}` : "Select history items to delete",
    historySelectedDeleteConfirm: (count: number) => `Delete ${count} selected history item${count === 1 ? "" : "s"}?`,
    historySelectedDeleted: (count: number) => `${count} history item${count === 1 ? "" : "s"} deleted.`,
    historyTagsUpdated: "History tags updated.",
    historyRenamed: "History image renamed.",
    historyEditName: "Edit image name",
    historyEditTags: "Edit history tags",
    historySaveName: "Save image name",
    historySaveTags: "Save history tags",
    historySystemTag: "System tag",
    historyImageName: "Image name",
    historyDuration: (duration: string) => `Took ${duration}`,
    historyPageSizeMenu: "History page size",
    historyPageSizeOption: (count: number) => `Show ${count} per page`,
    noJobsYet: "No jobs yet.",
    openJob: "Open job",
    historyResult: "History result",
    reuse: "Reuse",
    copyPrompt: "Copy prompt",
    removePromptChip: "Remove",
    delete: "Delete",
    openFolder: "Open folder",
    openHistoryFolder: "Open History folder",
    chooseHistoryFolder: "Set History folder",
    openGalleryFolder: "Open Gallery folder",
    chooseGalleryFolder: "Set Gallery folder",
    chooseStorageFolder: "Choose folder",
    historyStats: (count: number) => `${count} history item${count === 1 ? "" : "s"}`,
    galleryStats: (assetCount: number, folderCount: number) => `${assetCount} image${assetCount === 1 ? "" : "s"} · ${folderCount} folder${folderCount === 1 ? "" : "s"}`,
    historyStorageUpdated: "History storage folder updated.",
    storageFoldersUpdated: "History and Gallery storage folders updated.",
    storageFolderDialogDescription: "Choose where CrossGen stores managed images. Enable one shared path to update both libraries at once.",
    storageFolderSyncBoth: "Use the same path for History and Gallery",
    storageSharedPath: "Shared",
    updates: "Updates",
    currentVersion: "Current",
    checkUpdates: "Check",
    checkLatestVersion: "Check latest version",
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
    back: "Back",
    editImage: "Edit",
    cropImage: "Crop",
    drawTool: "Draw",
    textTool: "Text box",
    textBox: "Text box",
    quickColors: "Quick colors",
    chooseColor: (color: string) => `Use ${color}`,
    annotationColor: "Edit color",
    currentAnnotationColor: (color: string) => `Current color ${color.toUpperCase()}`,
    eyedropperTool: "Pick color from image",
    eyedropperActive: "Click the image to pick a color",
    annotationColorPicked: (color: string) => `Picked ${color.toUpperCase()}.`,
    annotationColorPickFailed: "Cannot pick a color from this image.",
    strokeWidth: "Stroke width",
    textSize: "Text size",
    boldText: "Bold",
    undo: "Undo",
    clearAnnotations: "Clear annotations",
    saveToGallery: "Save to Gallery",
    saveCropSelectionToGallery: "Save selected area to Gallery",
    downloadEditedImage: "Download edited image",
    editedDownloadStarted: "Edited image download started.",
    annotationRestoreFailed: "Cannot restore edit layer.",
    cropRectangle: "Rectangle crop",
    cropEllipse: "Ellipse crop",
    applyCrop: "Apply crop",
    cropApplied: "Crop applied.",
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
      maxInputs: (max: number) => `The current model supports up to ${max} reference images.`,
      paintOrUploadMask: "Paint a mask before inpainting.",
      generalProviderUnsupported: "The current API config does not have a General runtime.",
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
    theme: "外观",
    themeSystem: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色",
    english: "English",
    chinese: "中文",
    tagline: "一站式AI生图管理",
    provider: "API 配置",
    providerLabel: "API 类型",
    apiAccess: "API 配置",
    apiAccessShort: "配置",
    apiAccessName: "API 配置名称",
    apiAccessList: "已保存的 API 配置",
    apiAccessCurrentSlot: "当前使用",
    apiAccessDialogSummary: (count: number) => `${count} 个已保存配置 · 点击卡片编辑。`,
    apiAccessEditHint: "点击卡片后可在右侧编辑配置。",
    apiAccessUseNow: "立即使用该配置",
    apiAccessSelectedDetail: "配置信息",
    apiAccessModels: "支持的模型",
    apiAccessNoModels: "暂未探测到模型。",
    apiAccessSaved: "已保存",
    addApiAccess: "添加 API 配置",
    addingApiAccess: "添加中",
    switchApiAccess: "使用此 API 配置",
    currentApiAccess: "当前 API 配置",
    deleteApiAccess: "删除 API 配置",
    deleteLastApiAccessDisabled: "至少需要保留一个 API 配置。",
    confirmDeleteApiAccess: (name: string) => `确认删除 API 配置“${name}”？该配置保存的 Key 和模型探测结果会一并移除。`,
    apiAccessAdded: "API 配置已添加。",
    apiAccessDeleted: "API 配置已删除。",
    apiAccessSwitched: (name: string) => `已切换到 ${name}。`,
    apiAccessUntitled: "未命名 API 配置",
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
    generalRuntimeUnsupported: "当前 API 配置暂未接入 General 运行时。",
    generalLimitedRuntime: "General 使用 API 配置专属最小兜底能力。",
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
    promptTemplates: "提示词模板",
    promptTemplatesDescription: "保存并复用常用生图提示词。",
    templateTitle: "标题",
    templateBody: "模板提示词",
    templateTags: "标签",
    templateCategory: "分类",
    templateSearch: "搜索模板",
    templateAllTags: "全部",
    templateNew: "新建模板",
    templateSave: "保存模板",
    templateUpdate: "更新模板",
    templateEdit: "编辑模板",
    templateUse: "填入模板",
    templateImport: "导入模板",
    templateExport: "导出模板",
    templateEmpty: "暂无模板。",
    templateNoMatch: "没有匹配的模板。",
    templateDeleteConfirm: (title: string) => `确认删除模板“${title}”？`,
    templateSaved: "模板已保存。",
    templateDeleted: "模板已删除。",
    templateApplied: (title: string) => `已将模板“${title}”填入提示词。`,
    templateImported: (imported: number, skipped: number) => `已导入 ${imported} 个模板${skipped ? `，跳过 ${skipped} 个` : ""}。`,
    templateExported: (filePath: string) => `模板已导出到 ${filePath}`,
    library: "库",
    libraryConfig: "库路径配置",
    batchSelect: "批量选择",
    exitBatchSelect: "退出批量选择",
    gallery: "图库",
    galleryDescription: "方便随时调用的参考图库。",
    galleryFolders: "图库文件夹",
    galleryFolderCompactLabel: "文件夹",
    galleryAllFolders: "全部",
    galleryUncategorized: "未整理",
    galleryFolderFilter: "图库文件夹筛选",
    galleryTagFilter: "图库标签筛选",
    galleryTagCompactLabel: "标签",
    galleryFolderNew: "新建文件夹",
    galleryFolderName: "文件夹名称",
    galleryFolderCreate: "创建文件夹",
    galleryFolderRename: "重命名文件夹",
    galleryFolderDelete: "删除文件夹",
    galleryFolderContents: "图库文件夹内容",
    galleryViewMode: "图库视图模式",
    galleryGridView: "网格视图",
    galleryListView: "列表视图",
    gallerySelectItem: (name: string) => `选择 ${name}`,
    galleryOpenItem: (name: string) => `打开 ${name}`,
    galleryFolderItemMeta: (count: number, modifiedAt: string) => `${count} 张图片 · ${modifiedAt}`,
    galleryFolderDialogDescription: "图库文件夹会对应本地图库存储目录下的文件夹。",
    galleryFolderDeleteConfirm: (name: string) => `确认删除图库文件夹“${name}”？图片会保留在图库并移到未整理。`,
    galleryFolderCreated: "图库文件夹已创建。",
    galleryFolderRenamed: "图库文件夹已重命名。",
    galleryFolderMoved: "图库文件夹已移动。",
    galleryFolderMoveInvalid: "不能将文件夹移动到自身或其子文件夹。",
    galleryFolderDeleted: "图库文件夹已删除。",
    galleryFolderNameExists: "图库文件夹名称已存在。",
    gallerySelectionCount: (count: number) => `已选择 ${count} 项`,
    galleryClearSelection: "清除选择",
    galleryDeleteSelected: "删除所选",
    galleryDeleteSelectedTooltip: (count: number) => count > 0 ? `删除 ${count} 个所选图库项目` : "选择要删除的图库项目",
    gallerySelectedDeleteConfirm: (count: number) => `确认删除 ${count} 个所选图库项目？`,
    gallerySelectedDeleted: "所选图库项目已删除。",
    clearGalleryTooltip: "清空全部图库项目",
    confirmClearGalleryTitle: "确认清空图库？",
    confirmClearGalleryBody: (assetCount: number, folderCount: number) => `将删除 ${assetCount} 张图库图片和 ${folderCount} 个文件夹。`,
    confirmClearGallery: "确认清空图库",
    galleryCleared: "图库图片已清空。",
    galleryMoveToFolder: "移动到文件夹",
    galleryMoved: "图库图片已移动。",
    gallerySearch: "搜索图库",
    galleryAllTags: "全部",
    galleryImport: "导入图库",
    importShort: "导入",
    galleryChoose: "从图库选择",
    galleryAssetRename: "重命名图片",
    galleryAssetName: "图片名称",
    galleryAssetRenamed: "图库图片已重命名。",
    galleryAddHistory: "加入图库",
    galleryAddTargetFolder: "加入图库目标文件夹",
    galleryOpenedForPreview: (name: string) => `已在编辑区打开 ${name}。`,
    galleryAlreadyInGallery: "该图片已在图库中。",
    gallerySaveEditedTitle: "保存编辑后的图库图片",
    gallerySaveEditedBody: (name: string) => `覆盖“${name}”，还是将本次编辑另存为新的图库图片？`,
    galleryOverwrite: "覆盖",
    gallerySaveAsCopy: "另存为",
    galleryReplaced: "图库图片已覆盖。",
    gallerySavedAsCopy: "已另存为新的图库图片。",
    galleryEditTags: "编辑标签",
    gallerySaveTags: "保存标签",
    galleryAddCanceled: "已取消加入图库。",
    galleryImportCanceled: "已取消导入图库。",
    copyImagePath: "复制图片路径",
    imagePathCopied: "图片路径已复制。",
    tagManager: "管理标签",
    tagManagerDescription: "统一重命名或删除历史与图库中的标签。",
    tagRename: "重命名标签",
    tagDelete: "删除标签",
    tagRenamed: "标签已重命名。",
    tagDeleted: "标签已删除。",
    batchAddTags: "给所选添加标签",
    newTagPlaceholder: "新标签",
    addTag: "添加标签",
    noTagsYet: "暂无标签",
    batchTagsUpdated: "所选标签已更新。",
    galleryEmpty: "暂无图库图片。",
    galleryNoMatch: "没有匹配的图库图片。",
    galleryDeleteConfirm: (name: string) => `确认删除图库图片“${name}”？`,
    galleryImported: (count: number) => `已导入 ${count} 张图片到图库。`,
    galleryAdded: "已加入图库。",
    galleryPicked: (name: string) => `已将 ${name} 加入参考图。`,
    galleryUpdated: "图库标签已更新。",
    galleryDeleted: "图库图片已删除。",
    galleryStorageUpdated: "图库默认存储路径已更新。",
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
    streamPartialPreviewUnavailable: "流式局部预览仅支持 GPT Image 2 文生图生成。",
    streamPartialPreviewGenerateOnly: "流式局部预览仅支持文生图生成。",
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
    saveImage: "保存图片",
    generatedResult: "生成结果",
    jobFailed: "任务失败",
    outputEmpty: "生成图片和局部预览会显示在这里。",
    generatingElapsed: (seconds: number) => `正在生图，已耗时 ${seconds} 秒`,
    prompt: "提示词",
    running: "运行中",
    copy: "复制",
    addReferences: "添加参考图",
    addLocalReferences: "添加本地参考图",
    referenceLimitReached: (max: number) => `当前模型最多支持 ${max} 张参考图。`,
    uploadRightsReminder: "仅上传你有权使用的图片；已选择的参考图会发送给当前图片服务商。",
    uploadMask: "上传蒙版",
    uploadMaskTooltip: "上传已有蒙版图片。",
    addPaintedMask: "添加为蒙版",
    addPaintedMaskTooltip: "将已绘制区域添加为当前蒙版。",
    clear: "清除",
    noReferences: "未选择参考图。",
    dropReferencesHint: "可拖拽本地图片、历史或图库中的图片到此处。",
    source: "源图",
    reference: "参考图",
    mask: "蒙版",
    maskDescription: "涂抹需要替换的区域。多张参考图时，蒙版应用到第一张图片。",
    guidedRegionDescription: "将涂抹区域作为第一张图片的修改引导。",
    maskBrushSize: "调整蒙版画笔大小",
    clearPaintedMask: "清除已绘制蒙版",
    sourceForMask: "蒙版源图",
    addSourceForMask: "添加源图后可绘制蒙版。",
    checkingMask: "正在检查蒙版...",
    model: "模型",
    history: "历史",
    recentJobs: "最近任务",
    recentJobsDescription: "最近生成的任务与可复用结果。",
    clearHistory: "清空历史",
    clearAllHistoryTooltip: "清空全部历史记录",
    confirmClearHistoryTitle: "确认清空全部历史？",
    confirmClearHistoryBody: (count: number) => `将删除全部 ${count} 条历史记录及其托管结果文件。`,
    confirmClearHistory: "确认清空",
    cancel: "取消",
    searchPrompt: "搜索提示词",
    historyFilter: "历史筛选",
    filterAll: "全部",
    historySucceeded: "成功",
    historyFailed: "失败",
    sortNewest: "最新优先",
    sortOldest: "最早优先",
    sortName: "按名称",
    sortSize: "按大小",
    sortModified: "修改时间",
    historyMatchCount: (count: number) => `${count} 条匹配`,
    showAllHistory: () => "全部显示",
    collapseHistory: "收起",
    historyGridView: "网格视图",
    historyListView: "列表视图",
    historySelectItem: (name: string) => `选择历史项目 ${name}`,
    historySelectionCount: (count: number) => `已选择 ${count} 项`,
    historyDeleteSelected: "删除所选历史",
    historyDeleteSelectedTooltip: (count: number) => count > 0 ? `删除 ${count} 个所选历史项目` : "选择要删除的历史项目",
    historySelectedDeleteConfirm: (count: number) => `确认删除 ${count} 个所选历史项目？`,
    historySelectedDeleted: (count: number) => `已删除 ${count} 个历史项目。`,
    historyTagsUpdated: "历史标签已更新。",
    historyRenamed: "历史图片名称已更新。",
    historyEditName: "编辑图片名称",
    historyEditTags: "编辑历史标签",
    historySaveName: "保存图片名称",
    historySaveTags: "保存历史标签",
    historySystemTag: "系统标签",
    historyImageName: "图片名称",
    historyDuration: (duration: string) => `耗时 ${duration}`,
    historyPageSizeMenu: "历史每页数量",
    historyPageSizeOption: (count: number) => `每页显示 ${count} 条`,
    noJobsYet: "暂无任务。",
    openJob: "打开任务",
    historyResult: "历史结果",
    reuse: "复用",
    copyPrompt: "复制提示词",
    removePromptChip: "移除",
    delete: "删除",
    openFolder: "打开文件夹",
    openHistoryFolder: "打开历史目录",
    chooseHistoryFolder: "设置历史默认目录",
    openGalleryFolder: "打开图库目录",
    chooseGalleryFolder: "设置图库默认目录",
    chooseStorageFolder: "选择目录",
    historyStats: (count: number) => `${count} 条历史`,
    galleryStats: (assetCount: number, folderCount: number) => `${assetCount} 张图片 · ${folderCount} 个文件夹`,
    historyStorageUpdated: "历史默认存储路径已更新。",
    storageFoldersUpdated: "历史与图库默认存储路径已更新。",
    storageFolderDialogDescription: "选择 CrossGen 托管图片的本地存储目录。勾选同路径后，历史与图库会一次设置完成。",
    storageFolderSyncBoth: "历史与图库使用同一路径",
    storageSharedPath: "共同路径",
    updates: "升级",
    currentVersion: "当前版本",
    checkUpdates: "检查",
    checkLatestVersion: "检查最新版本",
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
    back: "返回",
    editImage: "编辑",
    cropImage: "裁剪",
    drawTool: "手绘",
    textTool: "添加文本框",
    textBox: "文本框",
    quickColors: "常用色块",
    chooseColor: (color: string) => `选择 ${color}`,
    annotationColor: "编辑颜色",
    currentAnnotationColor: (color: string) => `当前颜色 ${color.toUpperCase()}`,
    eyedropperTool: "从图片取色",
    eyedropperActive: "点击图片取色",
    annotationColorPicked: (color: string) => `已取色 ${color.toUpperCase()}。`,
    annotationColorPickFailed: "无法从这张图片取色。",
    strokeWidth: "笔触粗细",
    textSize: "字号大小",
    boldText: "加粗",
    undo: "回退",
    clearAnnotations: "清除批注",
    saveToGallery: "保存到图库",
    saveCropSelectionToGallery: "将选定区域存储到图库",
    downloadEditedImage: "下载编辑图",
    editedDownloadStarted: "编辑图下载已开始。",
    annotationRestoreFailed: "无法恢复编辑图层。",
    cropRectangle: "矩形裁剪",
    cropEllipse: "椭圆裁剪",
    applyCrop: "应用裁剪",
    cropApplied: "裁剪已应用。",
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
      maxInputs: (max: number) => `当前模型最多支持 ${max} 张参考图。`,
      paintOrUploadMask: "局部重绘前请先绘制蒙版。",
      generalProviderUnsupported: "当前 API 配置暂未接入 General 运行时。",
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
  "当前 API 配置暂未接入 General 运行时。": "generalProviderUnsupported",
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
