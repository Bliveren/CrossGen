/// <reference types="vite/client" />

import type { AppBridge } from "../shared/types";

declare global {
  interface Window {
    crossgen?: AppBridge;
    image2tools?: AppBridge;
  }
}
