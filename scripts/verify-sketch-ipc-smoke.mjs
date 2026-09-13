import { spawnSync } from "node:child_process";

const files = [
  "src/main/services/sketchAssetStore.test.ts",
  "src/shared/sketch.test.ts",
  "src/shared/validation.test.ts",
  "src/main/services/stateMigration.test.ts"
];

const result = spawnSync("pnpm", ["exec", "vitest", "run", ...files, "--reporter=dot"], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  console.error(`[sketch-ipc-smoke] ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
