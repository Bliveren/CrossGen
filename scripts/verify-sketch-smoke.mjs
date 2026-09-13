import { spawnSync } from "node:child_process";

const files = [
  "src/shared/sketch.test.ts",
  "src/renderer/SketchCanvas.test.tsx",
  "src/renderer/App.smoke.test.tsx",
  "src/main/services/openaiImage.test.ts",
  "src/main/services/geminiImageAdapter.test.ts",
  "src/main/services/generalImageAdapter.test.ts"
];

const result = spawnSync("pnpm", ["exec", "vitest", "run", ...files, "--reporter=dot"], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  console.error(`[sketch-smoke] ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
