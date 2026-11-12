import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const snapshots = require("./snapshots.cjs");
const backupFiles = require("../backend/backup-files.cjs");

let tmp, live, store;
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const hash = (manifest) =>
  createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const FREE = () => Number.MAX_SAFE_INTEGER;
const noSleep = vi.fn(async () => {});

async function snap(name, extra = {}) {
  const archive = path.join(store, name);
  const result = await snapshots.createSnapshot({
    root: live,
    archive,
    mode: "worldOnly",
    includes: ["world"],
    excludes: [],
    worldName: "world",
    freeBytes: FREE,
    sleep: noSleep,
    ...extra,
  });
  return { archive, ...result };
}

const realCopy = fs.promises.copyFile;
function failCopy(match, code, times = Infinity) {
  let count = 0;
  vi.spyOn(fs.promises, "copyFile").mockImplementation(async (from, to, ...rest) => {
    if (match.test(String(from).replace(/\\/g, "/")) && count++ < times)
      throw Object.assign(new Error(code), { code });
    return realCopy(from, to, ...rest);
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-trans-"));
  live = path.join(tmp, "server");
  store = path.join(tmp, "backups");
  fs.mkdirSync(store, { recursive: true });
  write(path.join(live, "world", "level.dat"), "level");
  write(path.join(live, "world", "region", "r.0.0.mca"), "region");
  write(path.join(live, "world", "playerdata", "a.dat"), "player");
  write(path.join(live, "world", "extra", "note.txt"), "note");
  noSleep.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("transient files in a snapshot", () => {
  it("skips a file that vanishes between scan and copy, and records it", async () => {
    failCopy(/note\.txt$/, "ENOENT");
    const made = await snap("a");
    expect(made.manifest.skippedFiles).toEqual(["world/extra/note.txt"]);
    expect(made.stats.skippedFiles).toEqual(["world/extra/note.txt"]);
    expect(made.manifest.files.map((f) => f.path)).not.toContain("world/extra/note.txt");
    expect(fs.existsSync(path.join(made.archive, "world/extra/note.txt"))).toBe(false);
  });

  it("skips a file that vanishes during the scan", async () => {
    const realLstat = fs.promises.lstat;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (target, ...rest) => {
      if (String(target).endsWith("note.txt"))
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      return realLstat(target, ...rest);
    });
    const made = await snap("a");
    expect(made.manifest.skippedFiles).toEqual(["world/extra/note.txt"]);
  });

  it("retries a locked file 3 times, then skips it", async () => {
    failCopy(/note\.txt$/, "EBUSY");
    const made = await snap("a");
    expect(noSleep).toHaveBeenCalledTimes(3);
    expect(made.manifest.skippedFiles).toEqual(["world/extra/note.txt"]);
  });

  it("copies a file whose lock clears within the retries", async () => {
    failCopy(/note\.txt$/, "EPERM", 2);
    const made = await snap("a");
    expect(made.manifest.skippedFiles).toBeUndefined();
    expect(made.manifest.files.map((f) => f.path)).toContain("world/extra/note.txt");
  });

  it.each([
    ["region file", /r\.0\.0\.mca$/],
    ["level.dat", /level\.dat$/],
    ["player data", /playerdata\/a\.dat$/],
  ])("still fails the backup when the %s stays locked", async (_n, match) => {
    failCopy(match, "EBUSY");
    await expect(snap("a")).rejects.toMatchObject({ code: "BACKUP_FILE_LOCKED" });
    expect(fs.readdirSync(store)).toEqual([]);
  });

  it("still fails on an unrelated error", async () => {
    failCopy(/note\.txt$/, "EIO");
    await expect(snap("a")).rejects.toMatchObject({ code: "EIO" });
  });

  it("a manifest with skippedFiles verifies, and restore keeps the live skipped file", async () => {
    failCopy(/note\.txt$/, "EBUSY");
    const made = await snap("a");
    vi.restoreAllMocks();
    const verified = await backupFiles.verifiedSnapshot(made.archive, hash(made.manifest));
    expect(verified.skippedFiles).toEqual(["world/extra/note.txt"]);
    write(path.join(live, "world", "level.dat"), "ruined");
    write(path.join(live, "world", "extra", "note.txt"), "locked live file");
    await backupFiles.restoreSnapshot({
      root: live,
      archive: made.archive,
      manifest: verified,
      resolve: (relative) => ({ target: path.join(live, relative) }),
    });
    expect(fs.readFileSync(path.join(live, "world", "level.dat"), "utf8")).toBe("level");
    expect(fs.readFileSync(path.join(live, "world", "extra", "note.txt"), "utf8")).toBe(
      "locked live file",
    );
  });

  it("the next snapshot works on top of one with skipped files", async () => {
    failCopy(/note\.txt$/, "EBUSY");
    const first = await snap("a");
    vi.restoreAllMocks();
    const second = await snap("b", { previous: { dir: first.archive, manifest: first.manifest } });
    expect(second.manifest.skippedFiles).toBeUndefined();
    expect(second.manifest.files.map((f) => f.path)).toContain("world/extra/note.txt");
    expect(second.stats.linkedFiles).toBeGreaterThan(0);
    await backupFiles.verifiedSnapshot(second.archive, hash(second.manifest));
  });
});

describe("full-server points", () => {
  it("leave out backup storage, session.lock and update staging files", async () => {
    write(path.join(live, "server.properties"), "a=b");
    write(path.join(live, "mods", "a.jar"), "jar");
    write(path.join(live, "mods", "a.jar.mcsm-update-123"), "staged");
    write(path.join(live, "mods", ".mcsm-download-9"), "staged");
    write(path.join(live, ".mcsm-import-1", "x"), "staged");
    write(path.join(live, "backups", "old", "f"), "history");
    write(path.join(live, "world", "session.lock"), "lock");
    const made = await snap("full", {
      mode: "fullServer",
      includes: [],
      excludes: [...snapshots.TRANSIENT_EXCLUDES],
    });
    const files = made.manifest.files.map((f) => f.path).sort();
    expect(files).toEqual([
      "mods/a.jar",
      "server.properties",
      "world/extra/note.txt",
      "world/level.dat",
      "world/playerdata/a.dat",
      "world/region/r.0.0.mca",
    ]);
    const verified = await backupFiles.verifiedSnapshot(made.archive, hash(made.manifest));
    expect(verified.mode).toBe("fullServer");
  });
});
