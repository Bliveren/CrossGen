import type { GallerySyncEvent, JobProgressEvent } from "../shared/types.js";

export interface JobEventSink {
  sendJobEvent(event: JobProgressEvent): void | Promise<void>;
}

export interface GalleryEventSink {
  sendGalleryEvent(event: GallerySyncEvent): void | Promise<void>;
}

export interface CoreEventSink extends JobEventSink, GalleryEventSink {}
