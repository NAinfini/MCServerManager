const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { isUtf8 } = require("node:buffer");
const { codedError } = require("../provisioning/contracts.cjs");

const MAX_TEXT_BYTES = 1024 * 1024;
const BINARY_EXTENSION =
  /\.(?:jar|zip|gz|7z|rar|dat|mca|mcr|nbt|png|jpe?g|gif|webp|ico|pdf|exe|dll|so|class|db|sqlite|woff2?|ttf)(?:\.disabled)?$/i;

function assertText(bytes) {
  if (bytes.length > MAX_TEXT_BYTES)
    throw codedError("FILE_TOO_LARGE_TO_EDIT", "file is too large to edit");
  if (
    !isUtf8(bytes) ||
    bytes.some((byte) => byte < 32 && ![9, 10, 13].includes(byte))
  )
    throw codedError("FILE_IS_BINARY", "binary files cannot be edited as text");
}

function textFile(target) {
  const stat = fs.statSync(target);
  if (!stat.isFile())
    throw codedError("PATH_NOT_A_FILE", "selected path is not a file");
  if (stat.size > MAX_TEXT_BYTES)
    throw codedError("FILE_TOO_LARGE_TO_EDIT", "file is too large to edit");
  const bytes = fs.readFileSync(target);
  if (BINARY_EXTENSION.test(target)) {
    throw codedError("FILE_IS_BINARY", "binary files cannot be edited as text");
  }
  assertText(bytes);
  return { bytes, revision: createHash("sha256").update(bytes).digest("hex") };
}

function listFiles(resolve, relativePath) {
  const { root, target } = resolve(relativePath);
  if (!fs.existsSync(target)) return [];
  return fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(target, entry.name);
    const stat = fs.lstatSync(fullPath);
    let editable = false;
    if (stat.isFile() && stat.size <= MAX_TEXT_BYTES) {
      try {
        textFile(fullPath);
        editable = true;
      } catch {
        /* Listing a binary file still succeeds. */
      }
    }
    return {
      name: entry.name,
      relativePath: path.relative(root, fullPath).replace(/\\/g, "/"),
      kind: entry.isDirectory() ? "directory" : "file",
      sizeBytes: stat.isFile() ? stat.size : 0,
      modifiedAt: stat.mtime.toISOString(),
      editable,
    };
  });
}

function readText(resolve, relativePath) {
  const { root, target } = resolve(relativePath);
  const { bytes, revision } = textFile(target);
  return {
    relativePath: path.relative(root, target).replace(/\\/g, "/"),
    content: bytes.toString("utf8"),
    sizeBytes: bytes.length,
    revision,
    readOnly: false,
    warning: null,
  };
}

function writeText(resolve, relativePath, content, expectedRevision) {
  const { target } = resolve(relativePath);
  const current = textFile(target);
  if (!expectedRevision || current.revision !== expectedRevision)
    throw codedError(
      "FILE_EDIT_CONFLICT",
      "file changed on disk; reload before saving",
    );
  const bytes = Buffer.from(String(content ?? ""), "utf8");
  assertText(bytes);
  const staged = `${target}.mcsm-write-${randomUUID()}`;
  try {
    fs.writeFileSync(staged, bytes, {
      flag: "wx",
      mode: fs.statSync(target).mode,
    });
    if (textFile(target).revision !== expectedRevision)
      throw codedError(
        "FILE_EDIT_CONFLICT",
        "file changed on disk; reload before saving",
      );
    fs.renameSync(staged, target);
  } finally {
    fs.rmSync(staged, { force: true });
  }
  return readText(resolve, relativePath);
}

async function mutateFiles(resolve, input) {
  const { root, target } = resolve(input.relativePath);
  const normalized = (value) => path.relative(root, value).replace(/\\/g, "/");
  const requireNew = (destination) => {
    if (fs.existsSync(destination))
      throw codedError("FILE_TARGET_EXISTS", "destination already exists");
    if (!fs.statSync(path.dirname(destination)).isDirectory())
      throw codedError(
        "PATH_NOT_A_DIRECTORY",
        "parent path is not a directory",
      );
  };
  if (input.operation !== "upload" && target === root)
    throw codedError(
      "SERVER_ROOT_MUTATION_FORBIDDEN",
      "the server root cannot be renamed or deleted",
    );
  switch (input.operation) {
    case "createFile":
      requireNew(target);
      assertText(Buffer.from(String(input.content ?? ""), "utf8"));
      fs.writeFileSync(target, String(input.content ?? ""), {
        encoding: "utf8",
        flag: "wx",
      });
      return { relativePaths: [normalized(target)] };
    case "createDirectory":
      requireNew(target);
      fs.mkdirSync(target);
      return { relativePaths: [normalized(target)] };
    case "rename":
    case "move": {
      const destination = resolve(input.targetRelativePath).target;
      requireNew(destination);
      if (destination.startsWith(`${target}${path.sep}`))
        throw codedError(
          "FILE_MOVE_INTO_SELF",
          "a directory cannot be moved into itself",
        );
      fs.renameSync(target, destination);
      return { relativePaths: [normalized(destination)] };
    }
    case "delete":
      if (!input.confirmDelete)
        throw codedError(
          "FILE_DELETE_NEEDS_CONFIRMATION",
          "file deletion requires explicit confirmation",
        );
      await fs.promises.rm(target, { recursive: true });
      return { relativePaths: [normalized(target)] };
    case "upload": {
      if (!fs.statSync(target).isDirectory())
        throw codedError(
          "PATH_NOT_A_DIRECTORY",
          "upload target is not a directory",
        );
      if (!Array.isArray(input.sourcePaths) || input.sourcePaths.length === 0)
        throw codedError(
          "CONTENT_SOURCE_FILE_MISSING",
          "select files to upload",
        );
      const copies = input.sourcePaths.map((source) => {
        if (typeof source !== "string" || !fs.statSync(source).isFile())
          throw codedError("PATH_NOT_A_FILE", "upload source is not a file");
        const destination = resolve(
          normalized(path.join(target, path.basename(source))),
        ).target;
        requireNew(destination);
        return { source, destination };
      });
      if (
        new Set(copies.map((copy) => copy.destination.toLowerCase())).size !==
        copies.length
      )
        throw codedError(
          "FILE_TARGET_EXISTS",
          "upload contains duplicate file names",
        );
      const written = [];
      try {
        for (const copy of copies) {
          await fs.promises.copyFile(
            copy.source,
            copy.destination,
            fs.constants.COPYFILE_EXCL,
          );
          written.push(copy.destination);
        }
      } catch (error) {
        for (const destination of written)
          await fs.promises.rm(destination, { force: true });
        throw error;
      }
      return { relativePaths: written.map(normalized) };
    }
    default:
      throw codedError("FILE_OPERATION_INVALID", "unsupported file operation");
  }
}

module.exports = { listFiles, readText, writeText, mutateFiles };
