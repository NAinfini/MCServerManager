"use strict";
/*
 * Zip is only ever produced here, on an explicit export. Snapshots on disk are
 * plain directory trees. Also reads old zip-shaped backup rows so they stay
 * restorable.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yazl = require("yazl");
const { extractZipArchive } = require("../provisioning/archive.cjs");
const backupFiles = require("../backend/backup-files.cjs");

const portable = (value) => value.replace(/\\/g, "/");

async function listFiles(root, relative = "", found = []) {
  for (const entry of await fs.promises.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const next = portable(path.join(relative, entry.name));
    if (entry.isDirectory()) await listFiles(root, next, found);
    else if (entry.isFile()) found.push(next);
  }
  return found;
}

/* Writes `<destination>` atomically (temp name, then rename). The snapshot's
   own manifest is left out: the zip is for people to open. */
async function zipDirectory(sourceDir, destination) {
  const files = (await listFiles(sourceDir)).filter(
    (file) => file !== backupFiles.MANIFEST,
  );
  const temporary = `${destination}.partial`;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const zip = new yazl.ZipFile();
  const written = new Promise((resolve, reject) => {
    const output = fs.createWriteStream(temporary);
    output.on("close", resolve);
    output.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(output);
  });
  for (const file of files)
    zip.addFile(path.join(sourceDir, file), file, { forceZip64Format: false });
  zip.end();
  try {
    await written;
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  return { fileCount: files.length };
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/* An old zip backup has no manifest we can trust, so extract it, then build the
   manifest from what came out. Zip CRCs are checked by the extractor. The zip
   either holds the world folder at its top level or is the world folder's
   contents; both are mapped onto `<worldName>/...`. */
async function openLegacyZip(zipPath, tempDir, worldName) {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
  await extractZipArchive(zipPath, tempDir);
  const top = await fs.promises.readdir(tempDir);
  const hasWorldFolder = top.includes(worldName);
  const archive = hasWorldFolder ? tempDir : path.join(`${tempDir}-wrapped`);
  if (!hasWorldFolder) {
    await fs.promises.rm(archive, { recursive: true, force: true });
    await fs.promises.mkdir(archive, { recursive: true });
    await fs.promises.rename(tempDir, path.join(archive, worldName));
  }
  const relativeFiles = await listFiles(archive);
  const files = [];
  for (const file of relativeFiles) {
    const full = path.join(archive, file);
    files.push({
      path: file,
      size: (await fs.promises.stat(full)).size,
      sha256: await digest(full),
    });
  }
  const includes = backupFiles.collapsePaths(
    hasWorldFolder ? top : [worldName],
  );
  return {
    archive,
    manifest: {
      version: 1,
      mode: "worldOnly",
      worldName,
      includes,
      excludes: [],
      files,
      directories: [],
    },
    dispose: () =>
      fs.promises.rm(archive, { recursive: true, force: true }),
  };
}

module.exports = { zipDirectory, openLegacyZip };
