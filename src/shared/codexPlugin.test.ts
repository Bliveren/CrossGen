import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve("plugins/crossgen");
const readJson = (file: string) => JSON.parse(readFileSync(path.join(pluginRoot, file), "utf8"));

describe("Codex plugin package", () => {
  it("ships a portable manifest with the required Agent Plugins fields", () => {
    const manifest = readJson("plugin.json");

    expect(manifest.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(manifest.name).toBe("crossgen");
    expect(manifest.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.license).toBe("MIT");

    // Only schema-declared top-level fields are allowed.
    const allowed = new Set([
      "$schema",
      "name",
      "version",
      "description",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
      "extensions"
    ]);
    for (const key of Object.keys(manifest)) {
      expect(allowed.has(key), `unexpected manifest field: ${key}`).toBe(true);
    }

    const openai = manifest.extensions?.["com.openai"];
    expect(openai?.interface?.displayName).toBe("CrossGen");
    expect(Array.isArray(openai?.interface?.capabilities)).toBe(true);
  });

  it("declares a stdio MCP server rooted at the plugin launcher", () => {
    const mcp = readJson("mcp.json");

    expect(mcp.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    const server = mcp.mcpServers?.crossgen;
    expect(server?.type).toBe("stdio");
    expect(server?.command).toBe("${PLUGIN_ROOT}/bin/crossgen");
    expect(server?.args).toEqual(["--mcp"]);
    // Read-only by default: paid generation requires an explicit mode change.
    expect(server?.env?.CROSSGEN_MCP_MODE).toBe("readonly");
  });

  it("bundles the crossgen-artist skill with its references", () => {
    const skill = readFileSync(path.join(pluginRoot, "skills/crossgen-artist/SKILL.md"), "utf8");
    expect(skill.startsWith("---")).toBe(true);
    expect(skill).toContain("name: crossgen-artist");

    for (const reference of ["cli-fallback.md", "harness-mcp.md", "mcp-tools.md", "model-workflows.md"]) {
      const referencePath = path.join(pluginRoot, "skills/crossgen-artist/references", reference);
      expect(statSync(referencePath).size).toBeGreaterThan(0);
    }
  });

  it("ships an executable POSIX launcher and a Windows launcher", () => {
    const posix = path.join(pluginRoot, "bin/crossgen");
    const windows = path.join(pluginRoot, "bin/crossgen.cmd");
    // Windows checkouts do not carry POSIX mode bits, so only assert the
    // executable bit on platforms that have them.
    if (process.platform !== "win32") {
      expect(statSync(posix).mode & 0o111).toBeGreaterThan(0);
    }
    expect(statSync(windows).size).toBeGreaterThan(0);

    const posixSource = readFileSync(posix, "utf8");
    // The launcher must delegate to the installed app rather than assuming a
    // repository checkout, and must keep --mcp brokering intact.
    expect(posixSource).toContain("CROSSGEN_APP_EXECUTABLE");
    expect(posixSource).toContain("/Applications/CrossGen.app");
    expect(posixSource).toContain('--mcp');
  });

  it("registers the plugin in the repository marketplace", () => {
    const marketplace = JSON.parse(readFileSync(path.resolve(".agents/plugins/marketplace.json"), "utf8"));
    expect(marketplace.name).toBe("crossgen-repo");
    const entry = marketplace.plugins?.find((item: { name: string }) => item.name === "crossgen");
    expect(entry).toBeDefined();
    expect(entry.source).toEqual({ source: "local", path: "./plugins/crossgen" });
    expect(entry.policy.installation).toBe("AVAILABLE");
    expect(entry.category).toBe("Productivity");
  });
});
