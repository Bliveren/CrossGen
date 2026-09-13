const WIDTH = 2048;
const HEIGHT = 2048;
const STROKES = 500;
const POINTS_PER_STROKE = 64;
const ROUNDS = 20;

function makeDocument() {
  const strokes = [];
  for (let strokeIndex = 0; strokeIndex < STROKES; strokeIndex += 1) {
    const points = [];
    for (let pointIndex = 0; pointIndex < POINTS_PER_STROKE; pointIndex += 1) {
      points.push({
        x: (strokeIndex * 13 + pointIndex * 7) % WIDTH,
        y: (strokeIndex * 17 + pointIndex * 11) % HEIGHT
      });
    }
    strokes.push({
      id: `stroke_${strokeIndex}`,
      tool: "brush",
      color: "#1f2937",
      size: 12,
      opacity: 1,
      points
    });
  }
  return { schemaVersion: 1, width: WIDTH, height: HEIGHT, background: "white", strokes };
}

function heapUsed() {
  return process.memoryUsage().heapUsed;
}

const before = heapUsed();
let retained = null;
for (let round = 0; round < ROUNDS; round += 1) {
  retained = makeDocument();
  if (typeof global.gc === "function") global.gc();
}
if (typeof global.gc === "function") global.gc();
const after = heapUsed();
const growthMb = (after - before) / (1024 * 1024);
const retainedPoints = retained?.strokes.reduce((total, stroke) => total + stroke.points.length, 0) ?? 0;
console.log(JSON.stringify({
  canvas: `${WIDTH}x${HEIGHT}`,
  rounds: ROUNDS,
  strokes: STROKES,
  points: retainedPoints,
  heapGrowthMb: Number(growthMb.toFixed(2)),
  gcAvailable: typeof global.gc === "function"
}, null, 2));

// This is a vector-state smoke, not a packaged Electron RSS SLO. It catches
// accidental unbounded retention in the document model while keeping the
// absolute threshold intentionally conservative across CI machines.
if (growthMb > 96) {
  console.error(`[sketch-memory-smoke] heap growth ${growthMb.toFixed(2)} MB exceeds 96 MB`);
  process.exit(1);
}
