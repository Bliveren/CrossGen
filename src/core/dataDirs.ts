import path from "node:path";

export const DEFAULT_STATE_FILE_NAME = "image2tools-state.v1.json";
export const DEFAULT_LEGACY_USER_DATA_NAME = "Image2Tools";
export const DEFAULT_QUEUE_FILE_NAME = "crossgen-queue.v1.json";
export const DEFAULT_MEDIA_ROOT_NAME = "media";

export interface DataDirResolutionInput {
  appDataDir: string;
  userDataDir?: string | null;
  legacyUserDataName?: string;
}

export interface ResolvedDataDirs {
  appDataDir: string;
  userDataDir: string;
  statePath: string;
  backupStatePath: string;
  lockPath: string;
  queuePath: string;
  queueLockPath: string;
  imagesDir: string;
  galleryDir: string;
  mediaRoot: string;
  mediaOriginalsDir: string;
  mediaPreviewsDir: string;
  mediaPostersDir: string;
  mediaTempDir: string;
  galleryThumbnailCacheDir: string;
  legacyImageRoots: string[];
}

export function resolveUserDataDir(input: DataDirResolutionInput): string {
  if (input.userDataDir?.trim()) return path.resolve(input.userDataDir.trim());
  return path.join(path.resolve(input.appDataDir), input.legacyUserDataName ?? DEFAULT_LEGACY_USER_DATA_NAME);
}

export function resolveDataDirs(input: DataDirResolutionInput): ResolvedDataDirs {
  const appDataDir = path.resolve(input.appDataDir);
  const legacyUserDataName = input.legacyUserDataName ?? DEFAULT_LEGACY_USER_DATA_NAME;
  const userDataDir = resolveUserDataDir({ ...input, appDataDir });
  const statePath = path.join(userDataDir, DEFAULT_STATE_FILE_NAME);
  const backupStatePath = `${statePath}.bak`;
  const lockPath = path.join(userDataDir, ".crossgen-state.lock");
  return {
    appDataDir,
    userDataDir,
    statePath,
    backupStatePath,
    lockPath,
    queuePath: path.join(userDataDir, DEFAULT_QUEUE_FILE_NAME),
    queueLockPath: lockPath,
    imagesDir: path.join(userDataDir, "images"),
    galleryDir: path.join(userDataDir, "gallery"),
    mediaRoot: path.join(userDataDir, DEFAULT_MEDIA_ROOT_NAME),
    mediaOriginalsDir: path.join(userDataDir, DEFAULT_MEDIA_ROOT_NAME, "originals"),
    mediaPreviewsDir: path.join(userDataDir, DEFAULT_MEDIA_ROOT_NAME, "previews"),
    mediaPostersDir: path.join(userDataDir, DEFAULT_MEDIA_ROOT_NAME, "posters"),
    mediaTempDir: path.join(userDataDir, DEFAULT_MEDIA_ROOT_NAME, "tmp"),
    galleryThumbnailCacheDir: path.join(userDataDir, "gallery-thumbnails"),
    legacyImageRoots: [
      path.join(userDataDir, "images"),
      path.join(appDataDir, "image2tools", "images"),
      path.join(appDataDir, legacyUserDataName, "images")
    ].map((item) => path.resolve(item))
  };
}
