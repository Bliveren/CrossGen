/// <reference types="vite/client" />

import type { AppBridge } from "../shared/types";

declare global {
  interface Window {
    image2tools?: AppBridge;
  }
}
