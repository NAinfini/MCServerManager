"use strict";
/*
 * Incremental snapshots.
 *
 * Every snapshot is a complete directory tree plus a `.mcsm-backup.json`
 * manifest that is compatible with backup-files.cjs (`verifiedSnapshot` and
 * `restoreSnapshot` work on it unchanged). A file that has the same size and
 * mtime as in the PREVIOUS SNAPSHOT is a hardlink to that snapshot's copy; a
 * changed file is copied.
 *
 * The one rule that matters: a hardlink is only ever created from a previous
 * snapshot, never from the live server directory. The server rewrites region
 * files in place, so a link to a live file would change history behind our
 * back. Restores copy out of the snapshot for the same reason (see
 * backup-files.cjs restoreSnapshot, which uses fs.cp).
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { codedError } = require("../provisioning/contracts.cjs");
const backupFiles = require("../backend/backup-files.cjs");

const MANIFEST = backupFiles.MANIFEST;
const PARTIAL = /\.partial-[0-9a-f]{8}$/;
// Errors that mean "this volume or file cannot be hardlinked", as opposed to a
// missing previous file. After one of these we stop trying for the snapshot.
const LINK_UNSUPPORTED = new Set([
  "EXDEV",
  "EPERM",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EMLINK",
  "EACCES",
  "ENOSYS",
  "EINVAL",
]);
const MIN_SPACE_MARGIN = 64 * 1024 * 1024;
const portable = (value) => value.replace(/\\/g, "/");

function sameMtime(a, b) {
  return (
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1
  );
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function nearestExisting(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function defaultFreeBytes(target) {
  const stats = fs.statfsSync(nearestExisting(target));
  return Number(stats.bavail) * Number(stats.bsize);
}

function formatMb(bytes) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

/* Walks the backup scope with lstat only (no hashing), refusing links and
   special files exactly like backup-files.cjs does. */
async function scan(root, paths, excludes, skipped = []) {
  const files = [];
  const directories = [];
  async function visit(relative) {
    if (backupFiles.excluded(relative, excludes)) return;
    const full = path.join(root, relative);
    let stat;
    try {
      stat = await fs.promises.lstat(full);
    } catch (error) {
      // Gone since its directory was listed: transient, not a failure.
      if (error?.code !== "ENOENT") throw error;
      skipped.push(relative);
      return;
    }
    if (stat.isSymbolicLink())
      throw codedError(
        "BACKUP_SYMLINK_UNSUPPORTED",
        "backup scope contains a symbolic link",
      );
    if (stat.isDirectory()) {
      directories.push(relative);
      let entries;
      try {
        entries = await fs.promises.readdir(full);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        skipped.push(relative);
        return;
      }
      for (const entry of entries)
        await visit(portable(path.join(relative, entry)));
    } else if (stat.isFile())
      files.push({ path: relative, size: stat.size, mtimeMs: stat.mtimeMs });
    else
      throw codedError(
        "BACKUP_SPECIAL_FILE_UNSUPPORTED",
        "backup scope contains a special file",
      );
  }
  for (const relative of paths) await visit(relative);
  return { files, directories };
}

async function scopePaths({ root, mode, includes, excludes }) {
  const cleanExcludes = (excludes || []).map((value) =>
    backupFiles.relativePath(value),
  );
  const paths =
    mode === "fullServer"
      ? (await fs.promises.readdir(root)).filter(
          (name) => !backupFiles.excluded(name, cleanExcludes),
        )
      : backupFiles.collapsePaths(
          (includes || []).map((value) => backupFiles.relativePath(value)),
        );
  if (!paths.length)
    throw codedError("BACKUP_EMPTY", "backup scope contains no files");
  return { paths, excludes: cleanExcludes };
}

/* The previous snapshot is only trusted as a link source when it is a real
   snapshot directory (it has a manifest) and is not the live server. */
function previousIndex(previous, root) {
  if (!previous?.dir || !previous.manifest) return null;
  const dir = path.resolve(previous.dir);
  const live = path.resolve(root);
  if (dir === live || live.startsWith(`${dir}${path.sep}`)) return null;
  if (!fs.existsSync(path.join(dir, MANIFEST))) return null;
  const entries = new Map();
  for (const file of previous.manifest.files || []) {
    if (
      typeof file.path === "string" &&
      typeof file.sha256 === "string" &&
      Number.isFinite(file.mtimeMs)
    )
      entries.set(file.path, file);
  }
  return { dir, entries };
}

function reusable(index, file) {
  const old = index?.entries.get(file.path);
  return Boolean(
    old && old.size === file.size && sameMtime(old.mtimeMs, file.mtimeMs),
  );
}

/* Throws BACKUP_INSUFFICIENT_SPACE rather than let a backup fill the disk.
   The need is the bytes that would really be written (files not reusable from
   the previous snapshot) plus a margin. */
function assertSpace(files, index, archive, freeBytes) {
  const logicalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const newBytes = files
    .filter((file) => !reusable(index, file))
    .reduce((sum, file) => sum + file.size, 0);
  const needBytes = newBytes + Math.max(MIN_SPACE_MARGIN, Math.ceil(newBytes * 0.05));
  const free = freeBytes(path.dirname(archive));
  if (Number.isFinite(free) && free < needBytes)
    throw codedError(
      "BACKUP_INSUFFICIENT_SPACE",
      `not enough free space for this backup: it needs about ${formatMb(needBytes)} and only ${formatMb(free)} is free on the backup drive`,
    );
  return { logicalBytes, newBytes, needBytes, freeBytes: free };
}

/* Cheap estimate used before the server is paused. */
async function planSnapshot({
  root,
  archive,
  mode,
  includes,
  excludes,
  previous,
  freeBytes = defaultFreeBytes,
}) {
  const scope = await scopePaths({ root, mode, includes, excludes });
  const { files } = await scan(root, scope.paths, scope.excludes);
  return assertSpace(files, previousIndex(previous, root), archive, freeBytes);
}

async function copyWithVerification(from, to, expected) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await fs.promises.copyFile(from, to);
    const after = await fs.promises.lstat(from);
    if (after.size === expected.size && sameMtime(after.mtimeMs, expected.mtimeMs)) {
      const when = new Date(expected.mtimeMs);
      await fs.promises.utimes(to, when, when);
      return sha256(to);
    }
    // The file moved under us. Take a fresh stat and try again; a file that
    // keeps changing is not consistent enough to snapshot.
    expected.size = after.size;
    expected.mtimeMs = after.mtimeMs;
  }
  throw codedError(
    "BACKUP_SOURCE_CHANGED",
    "a source file changed while the backup was being copied",
  );
}

/* Staging files that come and go under a running server. */
const TRANSIENT_EXCLUDES = Object.freeze([
  ".mcsm-*",
  "**/.mcsm-*",
  "**/*.mcsm-update-*",
  "**/*.mcsm-write-*",
  "**/*.mcsm-rollback-*",
  "**/*.mcsm-swap-*",
]);

/* A point without these is not a real restore point, so a lock on one of them
   fails the backup instead of being skipped. */
const CRITICAL_FILE = [/\.mca$/i, /(^|\/)level\.dat$/i, /(^|\/)playerdata\//i];
const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const LOCK_RETRIES = 3;
const LOCK_RETRY_DELAY_MS = 170;

/* Returns the sha256, or null when the file is transient and was left out.
   Mods hold files locked on Windows for a moment, so a lock is retried first. */
async function copyTolerant(file, source, destination, sleep) {
  for (let attempt = 0; ; attempt++) {
    try {
      const expected = { size: file.size, mtimeMs: file.mtimeMs };
      const sha = await copyWithVerification(source, destination, expected);
      file.size = expected.size;
      file.mtimeMs = expected.mtimeMs;
      return sha;
    } catch (error) {
      await fs.promises.rm(destination, { force: true }).catch(() => {});
      const critical = CRITICAL_FILE.some((pattern) => pattern.test(file.path));
      if (error?.code === "ENOENT") {
        // level.dat is replaced by rename, never legitimately absent.
        if (/(^|\/)level\.dat$/i.test(file.path))
          throw codedError(
            "BACKUP_SOURCE_CHANGED",
            "a source file changed while the backup was being copied",
          );
        return null;
      }
      if (!LOCK_CODES.has(error?.code)) throw error;
      if (attempt < LOCK_RETRIES) {
        await sleep(LOCK_RETRY_DELAY_MS);
        continue;
      }
      if (critical)
        throw codedError(
          "BACKUP_FILE_LOCKED",
          `${file.path} is locked by another program and cannot be backed up`,
        );
      return null;
    }
  }
}

async function createSnapshot({
  root,
  archive,
  mode,
  includes,
  excludes,
  worldName,
  serverState,
  previous = null,
  freeBytes = defaultFreeBytes,
  link = fs.promises.link,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const scope = await scopePaths({ root, mode, includes, excludes });
  const skipped = [];
  const { files, directories } = await scan(
    root,
    scope.paths,
    scope.excludes,
    skipped,
  );
  if (!files.length || !files.some((file) => file.size > 0))
    throw codedError("BACKUP_EMPTY", "backup scope contains no data");
  const index = previousIndex(previous, root);
  assertSpace(files, index, archive, freeBytes);

  if (fs.existsSync(archive))
    throw codedError("BACKUP_IN_PROGRESS", "backup folder already exists");
  const partial = `${archive}.partial-${randomUUID().slice(0, 8)}`;
  await fs.promises.mkdir(partial, { recursive: true });
  const stats = { copiedFiles: 0, linkedFiles: 0, newBytes: 0 };
  let linkDisabled = false;
  try {
    for (const directory of directories)
      await fs.promises.mkdir(path.join(partial, directory), {
        recursive: true,
      });
    const entries = [];
    for (const file of files) {
      const destination = path.join(partial, file.path);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      const source = path.join(root, file.path);
      let sha = null;
      if (index && !linkDisabled && reusable(index, file)) {
        const old = index.entries.get(file.path);
        // Link source is always inside the previous snapshot, never `root`.
        const from = path.join(index.dir, file.path);
        try {
          const stat = await fs.promises.lstat(from);
          if (!stat.isFile() || stat.size !== file.size)
            throw Object.assign(new Error("previous copy changed"), {
              code: "ENOENT",
            });
          await link(from, destination);
          sha = old.sha256;
          stats.linkedFiles += 1;
        } catch (error) {
          if (LINK_UNSUPPORTED.has(error?.code)) linkDisabled = true;
          await fs.promises.rm(destination, { force: true });
        }
      }
      if (sha === null) {
        sha = await copyTolerant(file, source, destination, sleep);
        if (sha === null) {
          skipped.push(file.path);
          continue;
        }
        stats.copiedFiles += 1;
        stats.newBytes += file.size;
      }
      entries.push({
        path: file.path,
        size: file.size,
        sha256: sha,
        mtimeMs: file.mtimeMs,
      });
    }
    const manifest = {
      version: 1,
      format: "incremental",
      mode,
      worldName,
      includes: scope.paths,
      excludes: scope.excludes,
      files: entries,
      directories,
      ...(skipped.length ? { skippedFiles: [...new Set(skipped)].sort() } : {}),
      ...(serverState ? { serverState } : {}),
    };
    await fs.promises.writeFile(
      path.join(partial, MANIFEST),
      JSON.stringify(manifest),
      "utf8",
    );
    // Atomic: until this rename the snapshot has no final name and no
    // consumer can mistake it for a finished one.
    await fs.promises.rename(partial, archive);
    const previousPaths = index ? [...index.entries.keys()] : [];
    const current = new Set(entries.map((entry) => entry.path));
    const identical =
      Boolean(index) &&
      stats.copiedFiles === 0 &&
      previousPaths.length === current.size &&
      previousPaths.every((entry) => current.has(entry));
    return {
      manifest,
      stats: {
        logicalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
        newBytes: stats.newBytes,
        copiedFiles: stats.copiedFiles,
        linkedFiles: stats.linkedFiles,
        skippedFiles: manifest.skippedFiles || [],
        identical,
      },
    };
  } catch (error) {
    await fs.promises.rm(partial, { recursive: true, force: true });
    throw error;
  }
}

/* A crash can leave `<id>.partial-xxxxxxxx` behind. They never have a final
   name, so they are never listed; this just reclaims the space. */
async function sweepPartials(parent) {
  let names;
  try {
    names = await fs.promises.readdir(parent);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!PARTIAL.test(name)) continue;
    await fs.promises.rm(path.join(parent, name), {
      recursive: true,
      force: true,
    });
    removed += 1;
  }
  return removed;
}

/* A snapshot counts as complete only with a final name and a manifest. */
function isCompleteSnapshot(dir) {
  return (
    !PARTIAL.test(dir) &&
    fs.existsSync(dir) &&
    fs.existsSync(path.join(dir, MANIFEST))
  );
}

async function readManifest(dir, expectedSha256) {
  try {
    const bytes = await fs.promises.readFile(path.join(dir, MANIFEST));
    if (
      expectedSha256 &&
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256
    )
      return null;
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

/* Bytes actually occupied by a set of snapshot manifests: a file shared by
   hardlink (same path and content) is counted once. */
function uniqueBytes(manifests) {
  const seen = new Set();
  let total = 0;
  for (const manifest of manifests) {
    for (const file of manifest?.files || []) {
      const key = `${file.path}\0${file.sha256}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += file.size;
    }
  }
  return total;
}

module.exports = {
  TRANSIENT_EXCLUDES,
  createSnapshot,
  planSnapshot,
  sweepPartials,
  isCompleteSnapshot,
  readManifest,
  uniqueBytes,
  defaultFreeBytes,
};
