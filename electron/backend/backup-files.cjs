const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { codedError } = require("../provisioning/contracts.cjs");

const MANIFEST = ".mcsm-backup.json";
const portable = (value) => value.replace(/\\/g, "/");

function relativePath(value, allowRoot = false) {
  const normalized = portable(String(value || "")).replace(/\/$/, "");
  if (
    (!normalized && !allowRoot) ||
    path.isAbsolute(normalized) ||
    /^[a-z]:/i.test(normalized) ||
    normalized
      .split("/")
      .some(
        (part) => part === ".." || part === "" || (part === "." && !allowRoot),
      )
  ) {
    throw codedError(
      "PATH_ESCAPES_SERVER_ROOT",
      "backup path must be relative to the server root",
    );
  }
  return normalized || ".";
}

function excluded(relative, patterns) {
  return (
    relative.toLowerCase() === "backups" ||
    relative.toLowerCase().startsWith("backups/") ||
    relative === MANIFEST ||
    patterns.some(
      (pattern) =>
        relative === pattern ||
        relative.startsWith(`${pattern}/`) ||
        path.matchesGlob(relative, pattern),
    )
  );
}

function collapsePaths(paths) {
  return [...new Set(paths)]
    .sort((a, b) => a.length - b.length)
    .filter(
      (value, index, values) =>
        !values
          .slice(0, index)
          .some((parent) => value.startsWith(`${parent}/`)),
    );
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(root, includes, excludes = [], directories = []) {
  const files = [];
  async function visit(relative) {
    if (excluded(relative, excludes)) return;
    const file = path.join(root, relative);
    const stat = await fs.promises.lstat(file);
    if (stat.isSymbolicLink())
      throw codedError(
        "BACKUP_SYMLINK_UNSUPPORTED",
        "backup scope contains a symbolic link",
      );
    if (stat.isDirectory()) {
      directories.push(relative);
      for (const entry of await fs.promises.readdir(file))
        await visit(portable(path.join(relative, entry)));
    } else if (stat.isFile())
      files.push({
        path: relative,
        size: stat.size,
        sha256: await digest(file),
      });
    else
      throw codedError(
        "BACKUP_SPECIAL_FILE_UNSUPPORTED",
        "backup scope contains a special file",
      );
  }
  for (const relative of collapsePaths(includes)) await visit(relative);
  return files;
}

async function writeSnapshot({
  root,
  archive,
  mode,
  includes,
  excludes,
  worldName,
  serverState,
}) {
  excludes = (excludes || []).map((value) => relativePath(value));
  const paths =
    mode === "fullServer"
      ? (await fs.promises.readdir(root)).filter(
          (name) => !excluded(name, excludes),
        )
      : collapsePaths(includes.map((value) => relativePath(value)));
  if (!paths.length)
    throw codedError("BACKUP_EMPTY", "backup scope contains no files");
  const directories = [];
  const files = await inventory(root, paths, excludes, directories);
  if (!files.length || !files.some((file) => file.size > 0))
    throw codedError("BACKUP_EMPTY", "backup scope contains no data");
  await fs.promises.mkdir(archive, { recursive: true });
  for (const directory of directories)
    await fs.promises.mkdir(path.join(archive, directory), { recursive: true });
  for (const entry of files) {
    const destination = path.join(archive, entry.path);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(path.join(root, entry.path), destination);
    if ((await digest(destination)) !== entry.sha256)
      throw codedError(
        "BACKUP_SOURCE_CHANGED",
        "a source file changed while the backup was being copied",
      );
  }
  const manifest = {
    version: 1,
    mode,
    worldName,
    includes: paths,
    excludes,
    files,
    directories,
    ...(serverState ? { serverState } : {}),
  };
  await fs.promises.writeFile(
    path.join(archive, MANIFEST),
    JSON.stringify(manifest),
    "utf8",
  );
  return manifest;
}

async function verifiedSnapshot(archive, expectedManifestHash) {
  let manifest;
  try {
    const bytes = await fs.promises.readFile(path.join(archive, MANIFEST));
    if (
      !expectedManifestHash ||
      createHash("sha256").update(bytes).digest("hex") !== expectedManifestHash
    )
      throw codedError(
        "BACKUP_MANIFEST_INVALID",
        "backup manifest does not match its recorded scope",
      );
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw codedError(
      "BACKUP_MANIFEST_INVALID",
      "backup manifest is missing or unreadable",
    );
  }
  if (
    manifest.version !== 1 ||
    !["worldOnly", "worldPlusConfigs", "custom", "fullServer"].includes(
      manifest.mode,
    ) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    !Array.isArray(manifest.includes) ||
    !Array.isArray(manifest.excludes)
  )
    throw codedError("BACKUP_MANIFEST_INVALID", "backup manifest is invalid");
  manifest.includes = collapsePaths(
    manifest.includes.map((value) => relativePath(value)),
  );
  manifest.excludes = manifest.excludes.map((value) => relativePath(value));
  if (manifest.includes.some((value) => excluded(value, [])))
    throw codedError(
      "BACKUP_MANIFEST_INVALID",
      "backup scope overlaps backup storage",
    );
  for (const entry of manifest.files) {
    entry.path = relativePath(entry.path);
    if (
      excluded(entry.path, manifest.excludes) ||
      !manifest.includes.some(
        (parent) =>
          entry.path === parent || entry.path.startsWith(`${parent}/`),
      )
    )
      throw codedError(
        "BACKUP_MANIFEST_INVALID",
        "backup file is outside its declared scope",
      );
  }
  const actual = await inventory(
    archive,
    manifest.includes,
    manifest.excludes,
  ).catch((error) => {
    if (error?.code === "ENOENT")
      throw codedError(
        "BACKUP_WORLD_MISSING",
        "backup world folder does not exist or a backup file is missing",
      );
    throw error;
  });
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  if (
    expected.size !== manifest.files.length ||
    actual.length !== expected.size ||
    actual.some(
      (file) =>
        file.size !== expected.get(file.path)?.size ||
        file.sha256 !== expected.get(file.path)?.sha256,
    )
  )
    throw codedError(
      "BACKUP_CHECKSUM_MISMATCH",
      "backup content does not match its manifest",
    );
  return manifest;
}

function restorePaths(manifest, targetWorldDir) {
  if (targetWorldDir === undefined || targetWorldDir === manifest.worldName)
    return (value) => value;
  if (path.isAbsolute(targetWorldDir))
    throw codedError("PATH_ESCAPES_SERVER_ROOT", "path escapes server root");
  if (
    !targetWorldDir ||
    [".", ".."].includes(targetWorldDir) ||
    /[/\\]/.test(targetWorldDir)
  )
    throw codedError(
      "RESTORE_TARGET_INVALID",
      "restore target must be a world folder name",
    );
  if (targetWorldDir.toLowerCase() === "backups")
    throw codedError(
      "RESTORE_TARGET_IS_BACKUP_STORAGE",
      "restore target must not overlap backup storage",
    );
  if (manifest.mode !== "worldOnly")
    throw codedError(
      "RESTORE_TARGET_INVALID",
      "only a world backup can be restored under a different world name",
    );
  return (value) =>
    value.replace(
      new RegExp(
        `^${manifest.worldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|_|$)`,
      ),
      () => targetWorldDir,
    );
}

function restoreScope(root, manifest) {
  return manifest.mode === "fullServer"
    ? collapsePaths([
        ...manifest.includes,
        ...fs
          .readdirSync(root)
          .filter((name) => !excluded(name, manifest.excludes)),
      ])
    : manifest.includes;
}

async function restoreSnapshot({
  root,
  archive,
  manifest,
  resolve,
  targetWorldDir,
  commit,
}) {
  const remap = restorePaths(manifest, targetWorldDir);
  const included = restoreScope(root, manifest);
  const transaction = path.join(root, "backups", `.restore-${randomUUID()}`);
  const entries = included.map((relative, index) => ({
    relative,
    target: resolve(remap(relative)).target,
    staged: path.join(transaction, "new", String(index)),
    old: path.join(transaction, "old", String(index)),
    installed: false,
    moved: false,
  }));
  await fs.promises.mkdir(path.join(transaction, "old"), { recursive: true });
  await fs.promises.mkdir(path.join(transaction, "new"), { recursive: true });
  let safeToClean = false;
  try {
    for (const entry of entries) {
      const source = path.join(archive, entry.relative);
      if (fs.existsSync(source))
        await fs.promises.cp(source, entry.staged, {
          recursive: true,
          filter: (candidate) =>
            !excluded(
              portable(path.relative(archive, candidate)),
              manifest.excludes,
            ),
        });
      // Excluded files belong to the live server and must survive a partial restore.
      if (
        fs.existsSync(entry.target) &&
        fs.statSync(entry.target).isDirectory()
      ) {
        async function preserve(current, suffix = "") {
          for (const name of await fs.promises.readdir(current)) {
            const child = path.join(current, name);
            const childSuffix = portable(path.join(suffix, name));
            const relative = portable(path.join(entry.relative, childSuffix));
            if (excluded(relative, manifest.excludes)) {
              await fs.promises.mkdir(
                path.dirname(path.join(entry.staged, childSuffix)),
                { recursive: true },
              );
              await fs.promises.cp(
                child,
                path.join(entry.staged, childSuffix),
                { recursive: true },
              );
            } else if ((await fs.promises.lstat(child)).isDirectory())
              await preserve(child, childSuffix);
          }
        }
        await preserve(entry.target);
      }
    }
    for (const file of manifest.files) {
      const entry = entries.find(
        (candidate) =>
          file.path === candidate.relative ||
          file.path.startsWith(`${candidate.relative}/`),
      );
      const stagedFile = path.join(
        entry.staged,
        path.relative(entry.relative, file.path),
      );
      if ((await digest(stagedFile)) !== file.sha256)
        throw codedError(
          "BACKUP_CHECKSUM_MISMATCH",
          "backup changed while restoration was being prepared",
        );
    }
    for (const entry of entries) {
      if (fs.existsSync(entry.target)) {
        fs.renameSync(entry.target, entry.old);
        entry.moved = true;
      }
      if (fs.existsSync(entry.staged)) {
        fs.mkdirSync(path.dirname(entry.target), { recursive: true });
        fs.renameSync(entry.staged, entry.target);
        entry.installed = true;
      }
    }
    commit?.();
    safeToClean = true;
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.installed)
        fs.rmSync(entry.target, { recursive: true, force: true });
      if (entry.moved) fs.renameSync(entry.old, entry.target);
    }
    safeToClean = true;
    throw error;
  } finally {
    // If an OS-level rollback itself fails, preserve the transaction directory
    // containing the only remaining originals for manual recovery.
    if (safeToClean)
      await fs.promises.rm(transaction, { recursive: true, force: true });
  }
}

module.exports = {
  writeSnapshot,
  verifiedSnapshot,
  restorePaths,
  restoreScope,
  restoreSnapshot,
  relativePath,
  excluded,
};
