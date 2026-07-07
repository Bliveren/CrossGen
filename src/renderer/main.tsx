import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    __crossgenProfilerEvents?: Array<{
      id: string;
      phase: "mount" | "update" | "nested-update";
      actualDuration: number;
      baseDuration: number;
      startTime: number;
      commitTime: number;
    }>;
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const enableProfiler = new URLSearchParams(window.location.search).has("crossgenPerf");
if (enableProfiler) {
  window.__crossgenProfilerEvents = [];
}

const app = enableProfiler ? (
  <React.Profiler
    id="App"
    onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      window.__crossgenProfilerEvents?.push({
        id,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime
      });
    }}
  >
    <App />
  </React.Profiler>
) : (
  <App />
);

createRoot(root).render(
  <React.StrictMode>
    {app}
  </React.StrictMode>
);
