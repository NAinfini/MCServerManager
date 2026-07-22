const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");
const { provisioningError } = require("./contracts.cjs");
const {
  isTransientFsError,
  retryTransientFsOperation,
} = require("./fs-retry.cjs");

const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 25_000,
  maxUncompressedBytes: 8 * 1024 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 250,
  maxJsonBytes: 4 * 1024 * 1024,
});

function limitsWithDefaults(limits = {}) {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
}

function unsafePathError(fileName, cause) {
  return provisioningError(
    "ARCHIVE_UNSAFE_PATH",
    `Archive entry has an unsafe path: ${fileName || "unknown"}`,
    { cause },
  );
}

function normalizeEntryPath(fileName) {
  const normalized = String(fileName || "").replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    /^\/{2}/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw unsafePathError(normalized);
  }
  const relativePath = normalized.replace(/^\.\//, "");
  const segments = relativePath.split("/");
  const hasUnsafeWindowsSegment = segments.some((segment, index) => {
    if (!segment) {
      return index !== segments.length - 1;
    }
    return (
      segment === "." ||
      segment.includes(":") ||
      /[. ]$/.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    );
  });
  if (!relativePath || hasUnsafeWindowsSegment) {
    throw unsafePathError(normalized);
  }
  return relativePath;
}

function isSymbolicLink(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function validateEntry(entry, state, limits) {
  const entryPath = normalizeEntryPath(entry.fileName);
  state.entryCount += 1;
  if (state.entryCount > limits.maxEntries) {
    throw provisioningError(
      "ARCHIVE_TOO_MANY_ENTRIES",
      `Archive contains more than ${limits.maxEntries} entries.`,
    );
  }
  if (isSymbolicLink(entry)) {
    throw provisioningError(
      "ARCHIVE_UNSAFE_LINK",
      `Archive entry is a symbolic link: ${entryPath}`,
    );
  }
  if (entry.isEncrypted?.() || !entry.canDecodeFileData?.()) {
    throw provisioningError(
      "ARCHIVE_UNSUPPORTED_ENTRY",
      `Archive entry is encrypted or uses unsupported compression: ${entryPath}`,
    );
  }
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw provisioningError(
      "ARCHIVE_ENTRY_TOO_LARGE",
      `Archive entry is too large: ${entryPath}`,
    );
  }
  state.uncompressedBytes += entry.uncompressedSize;
  if (state.uncompressedBytes > limits.maxUncompressedBytes) {
    throw provisioningError(
      "ARCHIVE_TOO_LARGE",
      `Archive expands beyond ${limits.maxUncompressedBytes} bytes.`,
    );
  }
  const ratio =
    entry.uncompressedSize === 0
      ? 0
      : entry.uncompressedSize / Math.max(1, entry.compressedSize);
  if (ratio > limits.maxCompressionRatio) {
    throw provisioningError(
      "ARCHIVE_SUSPICIOUS_RATIO",
      `Archive entry has a suspicious compression ratio: ${entryPath}`,
    );
  }
  return { entryPath, ratio };
}

function mapYauzlError(error) {
  if (
    /invalid relative path|absolute path|backslash/i.test(String(error?.message || ""))
  ) {
    return unsafePathError("unknown", error);
  }
  return error;
}

async function openZip(archivePath) {
  try {
    return await yauzl.openPromise(archivePath, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch (error) {
    throw mapYauzlError(error);
  }
}

async function inspectZip(archivePath, requestedLimits = {}) {
  const limits = limitsWithDefaults(requestedLimits);
  const zip = await openZip(archivePath);
  const entries = [];
  const state = { entryCount: 0, uncompressedBytes: 0 };
  try {
    for await (const entry of zip.eachEntry()) {
      const { entryPath, ratio } = validateEntry(entry, state, limits);
      entries.push({
        path: entryPath,
        directory: entryPath.endsWith("/"),
        compressedBytes: entry.compressedSize,
        uncompressedBytes: entry.uncompressedSize,
        compressionRatio: ratio,
      });
    }
  } catch (error) {
    throw mapYauzlError(error);
  } finally {
    zip.close();
  }
  return {
    entries,
    entryCount: state.entryCount,
    uncompressedBytes: state.uncompressedBytes,
  };
}

async function streamToBuffer(stream, maxBytes, entryPath) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      throw provisioningError(
        "ARCHIVE_ENTRY_TOO_LARGE",
        `Archive JSON entry is too large: ${entryPath}`,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function readJsonEntry(archivePath, requestedPath, requestedLimits = {}) {
  const limits = limitsWithDefaults(requestedLimits);
  const wanted = normalizeEntryPath(requestedPath);
  const zip = await openZip(archivePath);
  const state = { entryCount: 0, uncompressedBytes: 0 };
  try {
    for await (const entry of zip.eachEntry()) {
      const { entryPath } = validateEntry(entry, state, limits);
      if (entryPath !== wanted || entryPath.endsWith("/")) continue;
      const stream = await zip.openReadStreamPromise(entry);
      const buffer = await streamToBuffer(stream, limits.maxJsonBytes, entryPath);
      try {
        return JSON.parse(buffer.toString("utf8"));
      } catch (cause) {
        throw provisioningError(
          "ARCHIVE_INVALID_JSON",
          `Archive entry is not valid JSON: ${entryPath}`,
          { cause },
        );
      }
    }
  } catch (error) {
    throw mapYauzlError(error);
  } finally {
    zip.close();
  }
  throw provisioningError(
    "ARCHIVE_ENTRY_NOT_FOUND",
    `Archive entry was not found: ${wanted}`,
  );
}

function destinationPath(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw unsafePathError(relativePath);
  }
  return target;
}

async function extractLayer(archivePath, destination, layer, limits) {
  const prefix = layer.all ? null : normalizeEntryPath(layer.prefix);
  const zip = await openZip(archivePath);
  const state = { entryCount: 0, uncompressedBytes: 0 };
  try {
    for await (const entry of zip.eachEntry()) {
      const { entryPath } = validateEntry(entry, state, limits);
      if (prefix && !entryPath.startsWith(prefix)) continue;
      const relativePath = prefix && layer.stripPrefix
        ? entryPath.slice(prefix.length)
        : entryPath;
      if (!relativePath) continue;
      const target = destinationPath(destination, relativePath);
      if (entryPath.endsWith("/")) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // The read stream is single-use, so each attempt opens its own.
      await retryTransientFsOperation(async () => {
        const input = await zip.openReadStreamPromise(entry);
        const output = fs.createWriteStream(target, { flags: "w" });
        try {
          await pipeline(input, output);
        } catch (error) {
          fs.rmSync(target, { force: true });
          throw error;
        }
      }, `write archive entry ${relativePath}`);
    }
  } catch (error) {
    if (isTransientFsError(error)) {
      throw provisioningError(
        "ARCHIVE_WRITE_BLOCKED",
        `Extraction was denied by the operating system: ${error.code} on ${error.path || destination}. Another process is holding the file open -- antivirus real-time scanning is the usual cause. Exclude the application data directory and retry.`,
        { cause: error },
      );
    }
    throw mapYauzlError(error);
  } finally {
    zip.close();
  }
}

async function extractZipArchive(
  archivePath,
  destination,
  requestedLimits = {},
) {
  const limits = limitsWithDefaults(requestedLimits);
  fs.mkdirSync(destination, { recursive: true });
  await extractLayer(archivePath, destination, { all: true }, limits);
  return { destination };
}

async function extractZipLayers(
  archivePath,
  destination,
  layers,
  requestedLimits = {},
) {
  const limits = limitsWithDefaults(requestedLimits);
  fs.mkdirSync(destination, { recursive: true });
  for (const layer of layers) {
    await extractLayer(archivePath, destination, layer, limits);
  }
  return { destination };
}

module.exports = {
  DEFAULT_ARCHIVE_LIMITS,
  extractZipArchive,
  extractZipLayers,
  inspectZip,
  readJsonEntry,
};
