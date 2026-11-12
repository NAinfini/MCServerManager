import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const snapshots = require("./snapshots.cjs");
const backupFiles = require("../backend/backup-files.cjs");

let tmp, live, store;
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const read = (file) => fs.readFileSync(file, "utf8");
const manifestHash = (manifest) =>
  createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
/* Backdates a file so a later in-place edit is a different mtime even on a
   filesystem with coarse timestamps. */
const age = (file, secondsAgo) => {
  const when = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(file, when, when);
};
const FREE = () => Number.MAX_SAFE_INTEGER;

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
    ...extra,
  });
  return { archive, ...result };
}
const previousOf = (made) => ({ dir: made.archive, manifest: made.manifest });

/* True when this temp filesystem can hardlink at all (some CI volumes cannot). */
function canHardlink() {
  const a = path.join(tmp, "probe-a");
  const b = path.join(tmp, "probe-b");
  fs.writeFileSync(a, "x");
  try {
    fs.linkSync(a, b);
    return fs.statSync(a).nlink === 2;
  } catch {
    return false;
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-snap-"));
  live = path.join(tmp, "server");
  store = path.join(tmp, "backups");
  fs.mkdirSync(store, { recursive: true });
  write(path.join(live, "world", "region", "r.0.0.mca"), "region-one");
  write(path.join(live, "world", "level.dat"), "level-v1");
  age(path.join(live, "world", "region", "r.0.0.mca"), 300);
  age(path.join(live, "world", "level.dat"), 300);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("incremental snapshots", () => {
  it("never shares storage with the live world: an in-place edit leaves history alone", async () => {
    const first = await snap("s1");
    expect(first.stats.linkedFiles).toBe(0);
    const region = path.join(live, "world", "region", "r.0.0.mca");
    // The server rewrites region files in place (same inode).
    const fd = fs.openSync(region, "r+");
    fs.writeSync(fd, "REGION-TWO");
    fs.closeSync(fd);
    expect(read(path.join(first.archive, "world", "region", "r.0.0.mca"))).toBe(
      "region-one",
    );
    // and a later snapshot taken after that edit does not touch s1 either
    const second = await snap("s2", { previous: previousOf(first) });
    expect(read(path.join(second.archive, "world", "region", "r.0.0.mca"))).toBe(
      "REGION-TWO",
    );
    expect(read(path.join(first.archive, "world", "region", "r.0.0.mca"))).toBe(
      "region-one",
    );
    // No snapshot file is the same inode as a live file.
    for (const archive of [first.archive, second.archive])
      for (const file of ["world/level.dat", "world/region/r.0.0.mca"]) {
        expect(fs.statSync(path.join(archive, file)).ino).not.toBe(
          fs.statSync(path.join(live, file)).ino,
        );
      }
  });

  it("leaves out session.lock, which a running server holds locked on Windows", async () => {
    fs.writeFileSync(path.join(live, "world", "session.lock"), "lock");
    const result = await snap("s1");
    expect(fs.existsSync(path.join(result.archive, "world", "level.dat"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(result.archive, "world", "session.lock")),
    ).toBe(false);
  });

  it("links an unchanged file to the previous snapshot and copies a changed one", async () => {
    const first = await snap("s1");
    write(path.join(live, "world", "level.dat"), "level-v2-longer");
    const second = await snap("s2", { previous: previousOf(first) });
    expect(second.stats).toMatchObject({
      copiedFiles: 1,
      linkedFiles: 1,
      identical: false,
    });
    expect(second.stats.newBytes).toBe("level-v2-longer".length);
    expect(second.stats.logicalBytes).toBe(
      "region-one".length + "level-v2-longer".length,
    );
    expect(read(path.join(second.archive, "world", "level.dat"))).toBe(
      "level-v2-longer",
    );
    expect(read(path.join(first.archive, "world", "level.dat"))).toBe(
      "level-v1",
    );
    if (canHardlink()) {
      const a = fs.statSync(path.join(first.archive, "world/region/r.0.0.mca"));
      const b = fs.statSync(path.join(second.archive, "world/region/r.0.0.mca"));
      expect(b.ino).toBe(a.ino);
      expect(a.nlink).toBe(2);
    }
  });

  it("reports an identical snapshot so the caller can skip it", async () => {
    const first = await snap("s1");
    const second = await snap("s2", { previous: previousOf(first) });
    expect(second.stats).toMatchObject({ copiedFiles: 0, identical: true });
    expect(second.stats.newBytes).toBe(0);
  });

  it("falls back to copying when the previous snapshot is on another volume", async () => {
    const first = await snap("s1");
    const calls = [];
    const crossVolume = async (from, to) => {
      calls.push(to);
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    };
    const second = await snap("s2", {
      previous: previousOf(first),
      link: crossVolume,
    });
    expect(second.stats.linkedFiles).toBe(0);
    expect(second.stats.copiedFiles).toBe(2);
    expect(second.stats.newBytes).toBe(second.stats.logicalBytes);
    // After the first refusal it stops asking the volume.
    expect(calls).toHaveLength(1);
    expect(read(path.join(second.archive, "world", "level.dat"))).toBe(
      "level-v1",
    );
    const verified = await backupFiles.verifiedSnapshot(
      second.archive,
      manifestHash(second.manifest),
    );
    expect(verified.files).toHaveLength(2);
  });

  it("falls back to copying on a filesystem without hardlink support", async () => {
    const first = await snap("s1");
    const second = await snap("s2", {
      previous: previousOf(first),
      link: async () => {
        throw Object.assign(new Error("not permitted"), { code: "EPERM" });
      },
    });
    expect(second.stats.copiedFiles).toBe(2);
    expect(second.stats.linkedFiles).toBe(0);
  });

  it("never shows an interrupted snapshot as complete", async () => {
    const first = await snap("s1");
    const target = path.join(store, "s2");
    let during = null;
    // Everything is copied, then the final rename is made to fail by putting
    // something else under the final name part-way through.
    await expect(
      snap("s2", {
        previous: previousOf(first),
        link: async (from, to) => {
          if (!fs.existsSync(target)) write(path.join(target, "squatter"), "x");
          during = fs
            .readdirSync(store)
            .filter((name) => name.includes(".partial-"));
          return fs.promises.link(from, to);
        },
      }),
    ).rejects.toBeTruthy();
    // While it ran the work lived under a partial name only...
    expect(during).toHaveLength(1);
    // ...and the failure left no partial and no completed snapshot behind.
    expect(fs.readdirSync(store).filter((name) => name.includes(".partial-"))).toEqual([]);
    expect(snapshots.isCompleteSnapshot(target)).toBe(false);
  });

  it("treats a leftover partial directory as not a snapshot, and sweeps it", async () => {
    const partial = path.join(store, "s9.partial-0a1b2c3d");
    write(path.join(partial, "world", "level.dat"), "half");
    write(path.join(partial, ".mcsm-backup.json"), "{}");
    expect(snapshots.isCompleteSnapshot(partial)).toBe(false);
    expect(await snapshots.sweepPartials(store)).toBe(1);
    expect(fs.existsSync(partial)).toBe(false);
    const done = await snap("s1");
    expect(snapshots.isCompleteSnapshot(done.archive)).toBe(true);
  });

  it("keeps newer snapshots intact when an older one is deleted", async () => {
    const first = await snap("s1");
    write(path.join(live, "world", "level.dat"), "level-v2-longer");
    const second = await snap("s2", { previous: previousOf(first) });
    write(path.join(live, "world", "level.dat"), "level-v3-even-longer");
    const third = await snap("s3", { previous: previousOf(second) });
    fs.rmSync(first.archive, { recursive: true, force: true });
    for (const made of [second, third]) {
      const verified = await backupFiles.verifiedSnapshot(
        made.archive,
        manifestHash(made.manifest),
      );
      expect(verified.files.length).toBe(2);
    }
    expect(read(path.join(second.archive, "world/region/r.0.0.mca"))).toBe(
      "region-one",
    );
    expect(read(path.join(third.archive, "world/level.dat"))).toBe(
      "level-v3-even-longer",
    );
  });

  it("restores by copying, so editing the restored world cannot alter the snapshot", async () => {
    const first = await snap("s1");
    const hash = manifestHash(first.manifest);
    write(path.join(live, "world", "level.dat"), "damaged-live");
    const manifest = await backupFiles.verifiedSnapshot(first.archive, hash);
    await backupFiles.restoreSnapshot({
      root: live,
      archive: first.archive,
      manifest,
      resolve: (relative) => ({
        root: live,
        target: path.join(live, relative),
      }),
    });
    const restored = path.join(live, "world", "region", "r.0.0.mca");
    expect(read(path.join(live, "world", "level.dat"))).toBe("level-v1");
    expect(fs.statSync(restored).ino).not.toBe(
      fs.statSync(path.join(first.archive, "world/region/r.0.0.mca")).ino,
    );
    // The server writes into the restored file in place.
    const fd = fs.openSync(restored, "r+");
    fs.writeSync(fd, "SERVER-WROTE");
    fs.closeSync(fd);
    expect(read(path.join(first.archive, "world/region/r.0.0.mca"))).toBe(
      "region-one",
    );
    // Restored files keep their mtime, so the next snapshot can still link
    // the files that were not touched.
    const next = await snap("s2", { previous: previousOf(first) });
    expect(next.stats.linkedFiles).toBe(1);
    expect(next.stats.copiedFiles).toBe(1);
  });

  it("refuses to start when the drive cannot hold the new data", async () => {
    await expect(snap("s1", { freeBytes: () => 1024 })).rejects.toMatchObject({
      code: "BACKUP_INSUFFICIENT_SPACE",
      message: expect.stringMatching(/not enough free space/),
    });
    expect(fs.readdirSync(store)).toEqual([]);
    await expect(
      snapshots.planSnapshot({
        root: live,
        archive: path.join(store, "s1"),
        mode: "worldOnly",
        includes: ["world"],
        excludes: [],
        freeBytes: () => 1024,
      }),
    ).rejects.toMatchObject({ code: "BACKUP_INSUFFICIENT_SPACE" });
  });

  it("only needs space for what changed", async () => {
    const first = await snap("s1");
    // 70 MB of "free" space is enough for an unchanged snapshot (margin only).
    const second = await snap("s2", {
      previous: previousOf(first),
      freeBytes: () => 70 * 1024 * 1024,
    });
    expect(second.stats.identical).toBe(true);
  });

  it("does not use a legacy snapshot (no mtimes) or the live folder as a link source", async () => {
    const first = await snap("s1");
    const legacyManifest = {
      ...first.manifest,
      files: first.manifest.files.map(({ mtimeMs, ...rest }) => rest),
    };
    const second = await snap("s2", {
      previous: { dir: first.archive, manifest: legacyManifest },
    });
    expect(second.stats.linkedFiles).toBe(0);
    const viaLive = await snap("s3", {
      previous: { dir: live, manifest: first.manifest },
    });
    expect(viaLive.stats.linkedFiles).toBe(0);
    for (const file of ["world/level.dat", "world/region/r.0.0.mca"])
      expect(fs.statSync(path.join(live, file)).nlink).toBe(1);
  });

  it("counts hardlink-shared files once when measuring space used", async () => {
    const first = await snap("s1");
    write(path.join(live, "world", "level.dat"), "level-v2-longer");
    const second = await snap("s2", { previous: previousOf(first) });
    const used = snapshots.uniqueBytes([first.manifest, second.manifest]);
    expect(used).toBe(
      "region-one".length + "level-v1".length + "level-v2-longer".length,
    );
  });
});
