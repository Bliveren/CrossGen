import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupManagedMediaTemp,
  ensureManagedMediaDirectories,
  migrateManagedMediaRoot,
  normalizeManagedMediaRelativePath,
  resolveManagedMediaLayout,
  resolveManagedMediaPath
} from "./mediaStorage";

describe("mediaStorage", () => {
  it("creates an isolated managed media layout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgen-media-"));
    try {
      const layout = await ensureManagedMediaDirectories(root);
      expect(layout).toEqual(resolveManagedMediaLayout(root));
      await expect(mkdir(layout.originalsDir)).rejects.toMatchObject({ code: "EEXIST" });
      expect(resolveManagedMediaPath(root, "originals/image.png")).toBe(path.join(layout.originalsDir, "image.png"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal and absolute managed media paths", () => {
    expect(() => normalizeManagedMediaRelativePath("../image.png")).toThrow();
    expect(() => normalizeManagedMediaRelativePath("/tmp/image.png")).toThrow();
    expect(() => resolveManagedMediaPath("/tmp/media", "previews/../image.png")).toThrow();
  });

  it("removes only stale temporary media entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgen-media-cleanup-"));
    try {
      const layout = await ensureManagedMediaDirectories(root);
      const stale = path.join(layout.tempDir, "stale-job");
      const fresh = path.join(layout.tempDir, "fresh-job");
      await mkdir(stale);
      await mkdir(fresh);
      await writeFile(path.join(stale, "partial.bin"), "stale");
      await writeFile(path.join(fresh, "partial.bin"), "fresh");
      const now = Date.now();
      await utimes(stale, new Date(now - 10_000), new Date(now - 10_000));
      await utimes(fresh, new Date(now - 100), new Date(now - 100));

      const result = await cleanupManagedMediaTemp(root, { now, maxAgeMs: 1_000 });
      expect(result.scanned).toBe(2);
      expect(result.removed).toContain(stale);
      expect(result.retained).toContain(fresh);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates media roots with a staging swap and retains the source", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "crossgen-media-migrate-"));
    const source = path.join(parent, "source");
    const target = path.join(parent, "target");
    try {
      const sourceLayout = await ensureManagedMediaDirectories(source);
      await writeFile(path.join(sourceLayout.originalsDir, "source.png"), "source");
      await mkdir(path.join(target, "previews"), { recursive: true });
      await writeFile(path.join(target, "previews", "existing.png"), "existing");

      const result = await migrateManagedMediaRoot(source, target);

      expect(result).toMatchObject({
        sourceRoot: path.resolve(source),
        targetRoot: path.resolve(target),
        sourceRetained: true,
        copiedEntries: 2
      });
      await expect(readFile(path.join(target, "originals", "source.png"), "utf8")).resolves.toBe("source");
      await expect(readFile(path.join(target, "previews", "existing.png"), "utf8")).resolves.toBe("existing");
      await expect(readFile(path.join(source, "originals", "source.png"), "utf8")).resolves.toBe("source");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects nested media roots before copying", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "crossgen-media-nested-"));
    try {
      await expect(migrateManagedMediaRoot(parent, path.join(parent, "nested"))).rejects.toThrow("不能嵌套");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("restores the existing target when the staging swap fails", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "crossgen-media-rollback-"));
    const source = path.join(parent, "source");
    const target = path.join(parent, "target");
    try {
      const sourceLayout = await ensureManagedMediaDirectories(source);
      await writeFile(path.join(sourceLayout.originalsDir, "source.png"), "source");
      await mkdir(path.join(target, "previews"), { recursive: true });
      await writeFile(path.join(target, "previews", "existing.png"), "existing");

      let renameCount = 0;
      const injectedRename = async (from: string, to: string) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error("injected staging swap failure");
        await import("node:fs/promises").then(({ rename }) => rename(from, to));
      };

      await expect(migrateManagedMediaRoot(source, target, {
        idFactory: (() => {
          let index = 0;
          return () => `test-${index += 1}`;
        })(),
        rename: injectedRename
      })).rejects.toThrow("injected staging swap failure");

      await expect(readFile(path.join(target, "previews", "existing.png"), "utf8")).resolves.toBe("existing");
      await expect(readFile(path.join(target, "originals", "source.png"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(sourceLayout.originalsDir, "source.png"), "utf8")).resolves.toBe("source");
      const entries = await (await import("node:fs/promises")).readdir(parent);
      expect(entries.filter((entry) => entry.startsWith(".crossgen-media-"))).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
