const fs = require("node:fs");
const path = require("node:path");
const { inspectZip, readJsonEntry } = require("./archive.cjs");
const { provisioningError } = require("./contracts.cjs");

const SCRIPT_PATTERN = /(?:^|\/)[^/]+\.(?:bat|cmd|ps1|sh)$/i;

function requiredJavaMajorForMinecraft(minecraftVersion) {
  const match = String(minecraftVersion || "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3] || "0", 10);
  if (major > 1 || (minor === 20 && patch >= 5) || minor >= 21) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

function modrinthLoader(dependencies = {}) {
  const loaders = [
    ["fabric-loader", "fabric"],
    ["quilt-loader", "quilt"],
    ["neoforge", "neoForge"],
    ["forge", "forge"],
  ];
  for (const [key, loaderType] of loaders) {
    if (dependencies[key]) {
      return { loaderType, loaderVersion: String(dependencies[key]) };
    }
  }
  return { loaderType: "vanilla", loaderVersion: null };
}

function modrinthArtifact(file) {
  return {
    provider: "modrinth",
    path: String(file.path || ""),
    urls: Array.isArray(file.downloads) ? file.downloads.map(String) : [],
    url: Array.isArray(file.downloads) ? file.downloads[0] || null : null,
    hashes: file.hashes && typeof file.hashes === "object" ? file.hashes : {},
    size: Number(file.fileSize || 0),
    environment: "server",
  };
}

function planModrinth(packPath, inspection, index) {
  if (index?.game !== "minecraft" || index?.formatVersion !== 1) {
    throw provisioningError(
      "PACK_INVALID_MODRINTH_INDEX",
      "The archive does not contain a supported Modrinth pack index.",
    );
  }
  const dependencies = index.dependencies || {};
  const { loaderType, loaderVersion } = modrinthLoader(dependencies);
  const artifacts = [];
  const optionalFiles = [];
  const declaredFiles = Array.isArray(index.files) ? index.files : [];
  for (const file of declaredFiles) {
    const serverEnvironment = file?.env?.server || "required";
    if (serverEnvironment === "unsupported") continue;
    const artifact = modrinthArtifact(file);
    if (serverEnvironment === "optional") optionalFiles.push(artifact);
    else artifacts.push(artifact);
  }
  const entryPaths = new Set(inspection.entries.map((entry) => entry.path));
  const archiveLayers = [];
  if ([...entryPaths].some((entry) => entry.startsWith("overrides/"))) {
    archiveLayers.push({ prefix: "overrides/", stripPrefix: true });
  }
  if ([...entryPaths].some((entry) => entry.startsWith("server-overrides/"))) {
    archiveLayers.push({ prefix: "server-overrides/", stripPrefix: true });
  }
  const warnings = [];
  if (declaredFiles.length > 0 && artifacts.length === 0 && optionalFiles.length === 0) {
    warnings.push({
      code: "PACK_CLIENT_ONLY",
      message: "The Modrinth pack declares no files that can run on a dedicated server.",
      requiresAcknowledgement: true,
    });
  }
  const hashesPresent = [...artifacts, ...optionalFiles].every(
    (artifact) => Object.keys(artifact.hashes).length > 0,
  );
  return {
    source: { kind: "localModpackFile", path: packPath },
    pack: {
      format: "modrinth",
      name: String(index.name || path.basename(packPath, path.extname(packPath))),
      versionId: index.versionId ? String(index.versionId) : null,
    },
    minecraftVersion: dependencies.minecraft ? String(dependencies.minecraft) : null,
    loaderType,
    loaderVersion,
    requiredJavaMajor: requiredJavaMajorForMinecraft(dependencies.minecraft),
    artifacts,
    optionalFiles,
    archiveLayers,
    properties: {},
    warnings,
    integrity: { status: hashesPresent ? "verified" : "unverified" },
    estimatedBytes:
      inspection.uncompressedBytes +
      [...artifacts, ...optionalFiles].reduce((sum, artifact) => sum + artifact.size, 0),
  };
}

function curseForgeLoader(manifest) {
  const configured = (manifest?.minecraft?.modLoaders || []).find((loader) => loader.primary)
    || manifest?.minecraft?.modLoaders?.[0];
  const id = String(configured?.id || "");
  const match = id.match(/^(neoforge|neo-forge|forge|fabric|quilt)[-_](.+)$/i);
  if (!match) return { loaderType: "vanilla", loaderVersion: null };
  const normalized = match[1].toLowerCase();
  const loaderType = normalized === "neoforge" || normalized === "neo-forge"
    ? "neoForge"
    : normalized;
  return { loaderType, loaderVersion: match[2] };
}

function curseForgeArtifact(file) {
  return {
    provider: "curseforge",
    projectId: String(file.projectID ?? file.projectId ?? ""),
    fileId: String(file.fileID ?? file.fileId ?? ""),
    environment: "server",
  };
}

function planCurseForge(packPath, inspection, manifest) {
  if (!manifest?.minecraft?.version || !Array.isArray(manifest.files)) {
    throw provisioningError(
      "PACK_INVALID_CURSEFORGE_MANIFEST",
      "The archive does not contain a supported CurseForge manifest.",
    );
  }
  const { loaderType, loaderVersion } = curseForgeLoader(manifest);
  const artifacts = manifest.files.filter((file) => file.required !== false).map(curseForgeArtifact);
  const optionalFiles = manifest.files.filter((file) => file.required === false).map(curseForgeArtifact);
  const overridePrefix = String(manifest.overrides || "overrides").replace(/[\\/]+$/, "");
  const hasOverrides = inspection.entries.some((entry) =>
    entry.path.startsWith(`${overridePrefix}/`),
  );
  return {
    source: { kind: "localModpackFile", path: packPath },
    pack: {
      format: "curseforge",
      name: String(manifest.name || path.basename(packPath, path.extname(packPath))),
      versionId: manifest.version ? String(manifest.version) : null,
    },
    minecraftVersion: String(manifest.minecraft.version),
    loaderType,
    loaderVersion,
    requiredJavaMajor: requiredJavaMajorForMinecraft(manifest.minecraft.version),
    artifacts,
    optionalFiles,
    archiveLayers: hasOverrides
      ? [{ prefix: `${overridePrefix}/`, stripPrefix: true }]
      : [],
    properties: {},
    warnings: [],
    integrity: { status: "unverified" },
    estimatedBytes: inspection.uncompressedBytes,
  };
}

function planGeneric(packPath, inspection) {
  return {
    source: { kind: "localModpackFile", path: packPath },
    pack: {
      format: "generic",
      name: path.basename(packPath, path.extname(packPath)),
      versionId: null,
    },
    minecraftVersion: null,
    loaderType: null,
    loaderVersion: null,
    requiredJavaMajor: null,
    artifacts: [],
    optionalFiles: [],
    archiveLayers: [],
    properties: {},
    warnings: [
      {
        code: "PACK_UNVERIFIED",
        message: "This archive has no recognized server-pack manifest.",
        requiresAcknowledgement: true,
      },
    ],
    integrity: { status: "unverified" },
    estimatedBytes: inspection.uncompressedBytes,
  };
}

async function planLocalPack(packPath) {
  const resolvedPath = path.resolve(String(packPath || ""));
  if (!packPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw provisioningError("PACK_NOT_FOUND", "The selected modpack file does not exist.");
  }
  const inspection = await inspectZip(resolvedPath);
  const paths = new Set(inspection.entries.map((entry) => entry.path));
  let plan;
  if (paths.has("modrinth.index.json")) {
    plan = planModrinth(
      resolvedPath,
      inspection,
      await readJsonEntry(resolvedPath, "modrinth.index.json"),
    );
  } else if (paths.has("manifest.json")) {
    plan = planCurseForge(
      resolvedPath,
      inspection,
      await readJsonEntry(resolvedPath, "manifest.json"),
    );
  } else {
    plan = planGeneric(resolvedPath, inspection);
  }
  return {
    ...plan,
    ignoredScripts: inspection.entries
      .map((entry) => entry.path)
      .filter((entryPath) => SCRIPT_PATTERN.test(entryPath)),
  };
}

module.exports = { planLocalPack, requiredJavaMajorForMinecraft };
