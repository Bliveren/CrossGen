import path from "node:path";

const macDmgPattern = /^Image2Tools-.*-mac-.*\.dmg$/;

export function selectDmgFile(entries, packageVersion, releaseDir = path.resolve("release")) {
  const candidates = entries.filter((entry) => entry.isFile && macDmgPattern.test(entry.name));
  const versionedCandidates = packageVersion
    ? candidates.filter((entry) => entry.name.includes(`-${packageVersion}-`))
    : candidates;
  const selectedCandidates = versionedCandidates.length > 0 ? versionedCandidates : candidates;
  if (selectedCandidates.length !== 1) {
    throw new Error(
      `Expected one Image2Tools macOS dmg${packageVersion ? ` for version ${packageVersion}` : ""}, found ${selectedCandidates.length}: ${
        selectedCandidates.map((entry) => path.join(releaseDir, entry.name)).join(", ") || "none"
      }`
    );
  }
  return path.join(releaseDir, selectedCandidates[0].name);
}
