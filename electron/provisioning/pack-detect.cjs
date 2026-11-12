/* Works out what a dropped file is and what it needs, from the file alone.

   The rule that shaped this module: a conclusion is either stated by the pack
   (or measured from its contents) or it is absent. There is no default. A job
   once ran a "26.2 Fabric" pack on Minecraft 1.17.1 because a missing version
   was silently replaced by a guess, so every source that speaks about a version
   is recorded, the most authoritative one wins, and any disagreement becomes a
   warning instead of being resolved quietly.

   Zip entries are untrusted. Listing and reading go through archive.cjs, which
   rejects unsafe paths, links and oversized entries; the only extraction done
   here (mod jars, to read their descriptors) goes through the same extractor. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  extractZipLayers,
  inspectZip,
  readTextEntries,
} = require("./archive.cjs");
const { provisioningError } = require("./contracts.cjs");
const { readModMetadata } = require("./mod-metadata.cjs");

const MIB = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 25_000;
const MAX_TEXT_BYTES = 4 * MIB;
const MAX_INSPECTED_JARS = 600;
const MAX_INSPECTED_JAR_BYTES = 900 * MIB;
const JAR_CONCURRENCY = 8;

/* Folders a pack legitimately has at its top level. A single folder with one of
   these names is the pack itself, not a wrapper to flatten. */
const KNOWN_TOP_LEVEL = new Set([
  ".fabric",
  "config",
  "defaultconfigs",
  "kubejs",
  "libraries",
  "mods",
  "overrides",
  "client-overrides",
  "server-overrides",
  "resourcepacks",
  "scripts",
  "world",
]);

const SCRIPT_NAME = /^[^/]+\.(?:bat|cmd|ps1|sh)$/i;
const SERVER_SCRIPT_NAME = /^(?:run|start|launch|server)[^/]*\.(?:bat|cmd|ps1|sh)$/i;

function warning(code, message, params = {}) {
  return { code, message, params, requiresAcknowledgement: false };
}

/* ---- Minecraft version helpers ------------------------------------------ */

/* 1.x releases, and the 26.x scheme Mojang moved to. A bare "2.41" is a mod
   version, not a game version, so the second form is limited to 26-29. */
const MC_VERSION = /(?<![\d.])(1\.(?:[7-9]|[12]\d)(?:\.\d{1,2})?|2[6-9]\.\d{1,2}(?:\.\d{1,2})?)(?![\d])/;

function mcFromText(text) {
  return MC_VERSION.exec(String(text || ""))?.[1] ?? null;
}

function versionParts(value) {
  const parts = String(value || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some(Number.isNaN)) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function sameMc(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  return Boolean(a && b) && compareVersions(a, b) === 0;
}

/* Does a mod's declared Minecraft range admit this version? true / false, or
   null when the range is written in a form this does not understand -- an
   unknown is reported as unknown, never as a pass or a fail. Two grammars are
   in play: Fabric's semver-ish ranges and Maven intervals (Forge, NeoForge). */
function satisfiesMinecraft(range, version, grammar) {
  const target = versionParts(version);
  if (!target) return null;
  const alternatives = Array.isArray(range) ? range : [range];
  let unknown = false;
  for (const raw of alternatives) {
    const text = String(raw ?? "").trim();
    if (!text || text === "*") return true;
    const verdict =
      grammar === "maven"
        ? satisfiesMaven(text, target)
        : satisfiesSemver(text, target);
    if (verdict === true) return true;
    if (verdict === null) unknown = true;
  }
  return unknown ? null : false;
}

function satisfiesMaven(text, target) {
  const intervals = [
    ...text.matchAll(/([[(])\s*([^,\])[(]*?)\s*(?:,\s*([^\])[(]*?)\s*)?([\])])/g),
  ];
  if (intervals.length === 0) return null;
  let unknown = false;
  for (const [, open, low, high, close] of intervals) {
    if (high === undefined) {
      // "[1.20.1]" is an exact pin.
      const pin = versionParts(low);
      if (!pin) {
        unknown = true;
        continue;
      }
      if (compareVersions(target, pin) === 0) return true;
      continue;
    }
    const lowParts = low ? versionParts(low) : null;
    const highParts = high ? versionParts(high) : null;
    if ((low && !lowParts) || (high && !highParts)) {
      unknown = true;
      continue;
    }
    const aboveLow =
      !lowParts ||
      (open === "["
        ? compareVersions(target, lowParts) >= 0
        : compareVersions(target, lowParts) > 0);
    const belowHigh =
      !highParts ||
      (close === "]"
        ? compareVersions(target, highParts) <= 0
        : compareVersions(target, highParts) < 0);
    if (aboveLow && belowHigh) return true;
  }
  return unknown ? null : false;
}

function satisfiesSemver(text, target) {
  let unknown = false;
  for (const group of text.split("||")) {
    const comparators = group.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) continue;
    let allPass = true;
    for (const comparator of comparators) {
      const match = /^(>=|<=|>|<|=|~|\^)?\s*(\d+(?:\.(?:\d+|x|\*))*)(?:\.(?:x|\*))?$/i.exec(
        comparator,
      );
      if (!match) {
        unknown = true;
        allPass = false;
        break;
      }
      const operator = match[1] || "=";
      const wildcard = /[x*]/i.test(comparator);
      const written = match[2].split(".").filter((part) => !/[x*]/i.test(part));
      const base = versionParts(written.join("."));
      if (!base) {
        unknown = true;
        allPass = false;
        break;
      }
      let pass;
      if (operator === ">=") pass = compareVersions(target, base) >= 0;
      else if (operator === ">") pass = compareVersions(target, base) > 0;
      else if (operator === "<=") pass = compareVersions(target, base) <= 0;
      else if (operator === "<") pass = compareVersions(target, base) < 0;
      else if (operator === "~" || (operator === "=" && wildcard)) {
        // ~1.20 and 1.20.x both mean "the 1.20 line".
        const prefix = Math.max(1, Math.min(written.length, 2));
        pass = base.slice(0, prefix).every((part, i) => part === target[i]);
        if (operator === "~" && written.length >= 3) {
          pass = pass && target[2] >= base[2];
        }
      } else if (operator === "^") {
        pass = target[0] === base[0] && compareVersions(target, base) >= 0;
      } else {
        pass = compareVersions(target, base) === 0;
      }
      if (!pass) {
        allPass = false;
        break;
      }
    }
    if (allPass) return true;
  }
  return unknown ? null : false;
}

/* The version a range most plausibly points at, for inferring a pack's game
   version from its mods when nothing else states it: the lowest concrete
   version the range mentions. */
function versionNamedByRange(range) {
  const text = (Array.isArray(range) ? range : [range]).join(" ");
  return mcFromText(text);
}

/* ---- Loader helpers ------------------------------------------------------ */

function normalizeLoaderName(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (text === "neoforge" || text === "neoforged") return "neoForge";
  if (text === "forge" || text === "minecraftforge") return "forge";
  if (text === "fabric" || text === "fabricloader") return "fabric";
  if (text === "quilt" || text === "quiltloader") return "quilt";
  return null;
}

/* NeoForge numbers itself after the game: 21.1.77 is for 1.21.1 and 20.4.x for
   1.20.4, with a .0 patch written as plain 1.21. The 26.x scheme is not
   derived from -- there is no evidence yet how it maps. */
function minecraftFromNeoForge(version) {
  const full = /^1\.(\d{1,2}(?:\.\d{1,2})?)-/.exec(version);
  if (full) return `1.${full[1]}`;
  const match = /^(\d{2})\.(\d{1,2})\./.exec(version);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  if (major < 19 || major > 25) return null;
  return match[2] === "0" ? `1.${major}` : `1.${major}.${match[2]}`;
}

/* Reads loader and game version out of any text that names installed loader
   files: a path list or a run script. */
function loaderFromInstalledPaths(text) {
  const found = [];
  const neo = /libraries\/net\/neoforged\/neoforge\/([^/\s"'\\]+)/.exec(text);
  if (neo) {
    found.push({
      type: "neoForge",
      version: neo[1],
      mc: minecraftFromNeoForge(neo[1]),
    });
  }
  const forge = /libraries\/net\/minecraftforge\/forge\/([^/\s"'\\]+)/.exec(text);
  if (forge) {
    const [mc, version] = forge[1].split("-");
    found.push({ type: "forge", version: version || null, mc: mc || null });
  }
  const fabric = /libraries\/net\/fabricmc\/fabric-loader\/([^/\s"'\\]+)/.exec(
    text,
  );
  const intermediary = /libraries\/net\/fabricmc\/intermediary\/([^/\s"'\\]+)/.exec(
    text,
  );
  if (fabric || intermediary) {
    found.push({
      type: "fabric",
      version: fabric?.[1] ?? null,
      mc: intermediary?.[1] ?? null,
    });
  }
  const quilt = /libraries\/org\/quiltmc\/quilt-loader\/([^/\s"'\\]+)/.exec(
    text,
  );
  if (quilt) found.push({ type: "quilt", version: quilt[1], mc: null });
  return found;
}

/* ---- Memory -------------------------------------------------------------- */

/* Heap for a modded server by how much it has to load, held back from the
   machine's RAM so the OS, the game client and the launcher keep headroom.
   Nothing here is a measured requirement; it is the usual community guidance
   for these pack sizes, shaped by what this machine can spare. */
function recommendMemory({ modCount, totalMemoryMb, statedMaxMb = null }) {
  let wantMb;
  if (modCount <= 0) wantMb = 2048;
  else if (modCount <= 50) wantMb = 4096;
  else if (modCount <= 150) wantMb = 6144;
  else if (modCount <= 300) wantMb = 8192;
  else if (modCount <= 500) wantMb = 10240;
  else wantMb = 12288;
  const total = Number(totalMemoryMb) > 0 ? Number(totalMemoryMb) : null;
  const headroomMb = total ? Math.max(4096, Math.round(total * 0.35)) : 0;
  const capMb = total ? Math.max(2048, total - headroomMb) : null;
  const floorTo512 = (value) => Math.max(1024, Math.floor(value / 512) * 512);
  let maxMb = wantMb;
  let source = "recommended";
  let capped = false;
  if (statedMaxMb) {
    maxMb = statedMaxMb;
    source = "pack";
  }
  if (capMb && maxMb > capMb) {
    capped = true;
    maxMb = capMb;
  }
  maxMb = floorTo512(maxMb);
  return {
    maxMb,
    minMb: Math.min(maxMb, 1024),
    source,
    capped,
    wantMb: statedMaxMb || wantMb,
    capMb,
    totalMb: total,
  };
}

function parseHeapMb(text) {
  const match = /-Xmx(\d+)([GgMm])/.exec(text || "");
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return match[2].toLowerCase() === "g" ? value * 1024 : value;
}

/* ---- Pack sources: a zip and a folder look the same to the detector ------ */

function posix(value) {
  return String(value).replace(/\\/g, "/");
}

function walkDirectory(root) {
  const files = [];
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop();
    const absolute = path.join(root, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (files.length > MAX_DIRECTORY_ENTRIES) {
        throw provisioningError(
          "ARCHIVE_TOO_MANY_ENTRIES",
          `Folder contains more than ${MAX_DIRECTORY_ENTRIES} entries.`,
        );
      }
      if (entry.isDirectory()) {
        files.push({ path: `${child}/`, directory: true, bytes: 0 });
        pending.push(child);
      } else if (entry.isFile()) {
        files.push({
          path: child,
          directory: false,
          bytes: fs.statSync(path.join(root, child)).size,
        });
      }
    }
  }
  return files;
}

async function openZipSource(archivePath) {
  const inspection = await inspectZip(archivePath);
  return {
    kind: "zip",
    entries: inspection.entries.map((entry) => ({
      path: entry.path,
      directory: entry.directory,
      bytes: entry.uncompressedBytes,
    })),
    totalBytes: inspection.uncompressedBytes,
    async readText(paths) {
      return readTextEntries(archivePath, paths);
    },
    async materializeJars(jarPaths, budget) {
      const wanted = new Set(jarPaths);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-detect-"));
      let count = 0;
      let bytes = 0;
      try {
        await extractZipLayers(archivePath, directory, [
          {
            prefix: "",
            all: true,
            filter: (entryPath, entry) => {
              if (!wanted.has(entryPath)) return false;
              if (
                count >= budget.maxJars ||
                bytes + entry.uncompressedSize > budget.maxBytes
              ) {
                return false;
              }
              count += 1;
              bytes += entry.uncompressedSize;
              return true;
            },
          },
        ]);
      } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return {
        resolve: (jarPath) => {
          const target = path.join(directory, ...jarPath.split("/"));
          return fs.existsSync(target) ? target : null;
        },
        cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
      };
    },
  };
}

function openDirectorySource(root) {
  const entries = walkDirectory(root);
  const resolveInside = (relative) => {
    const target = path.resolve(root, ...relative.split("/"));
    const inside = path.relative(path.resolve(root), target);
    if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
    return target;
  };
  return {
    kind: "directory",
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    async readText(paths) {
      const found = new Map();
      for (const relative of paths) {
        const target = resolveInside(relative);
        if (!target || !fs.existsSync(target)) continue;
        const stat = fs.statSync(target);
        if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) continue;
        found.set(relative.toLowerCase(), fs.readFileSync(target, "utf8"));
      }
      return found;
    },
    async materializeJars() {
      return {
        resolve: (jarPath) => {
          const target = resolveInside(jarPath);
          return target && fs.existsSync(target) ? target : null;
        },
        cleanup: () => undefined,
      };
    },
  };
}

/* One wrapper folder around everything is how most zip tools package a folder.
   Returns the prefix to strip ("" when the pack already starts at its root). */
function wrapperPrefix(entries) {
  const names = entries
    .map((entry) => entry.path)
    .filter((entryPath) => !entryPath.startsWith("__MACOSX/"));
  if (names.length === 0 || names.some((name) => !name.includes("/"))) {
    return "";
  }
  const tops = new Set(names.map((name) => name.split("/")[0]));
  if (tops.size !== 1) return "";
  const [top] = tops;
  if (KNOWN_TOP_LEVEL.has(top.toLowerCase())) return "";
  return `${top}/`;
}

/* ---- Mod descriptors ----------------------------------------------------- */

const DECLARATION_ENTRIES = [
  "fabric.mod.json",
  "quilt.mod.json",
  "META-INF/mods.toml",
  "META-INF/neoforge.mods.toml",
  "mcmod.info",
];

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tomlBlocks(raw) {
  return String(raw)
    .split(/^\s*\[\[/m)
    .slice(1)
    .map((block) => {
      const end = block.indexOf("]]");
      return { header: block.slice(0, end).trim(), body: block.slice(end + 2) };
    });
}

function tomlValue(body, key) {
  return (
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]*)["']`, "im").exec(body)?.[1] ??
    null
  );
}

/* What a jar declares about where it runs. Each field is null unless the jar
   says it in so many words; nothing is guessed from a name or a package. */
function readDeclaration(entries) {
  const get = (name) => entries.get(name.toLowerCase()) ?? null;
  const declaration = {
    loader: null,
    side: null,
    sideSource: null,
    mcRange: null,
    mcGrammar: null,
  };
  const fabric = get("fabric.mod.json") ? safeJson(get("fabric.mod.json")) : null;
  if (fabric) {
    declaration.loader = "fabric";
    const environment = String(fabric.environment ?? "").toLowerCase();
    if (environment === "client") {
      declaration.side = "client";
      declaration.sideSource = "fabric.mod.json: environment=client";
    } else if (environment === "server") {
      declaration.side = "server";
    } else if (environment === "*") {
      declaration.side = "both";
    }
    declaration.mcRange = fabric.depends?.minecraft ?? null;
    declaration.mcGrammar = "semver";
    return declaration;
  }
  const quilt = get("quilt.mod.json") ? safeJson(get("quilt.mod.json")) : null;
  if (quilt?.quilt_loader) {
    declaration.loader = "quilt";
    const environment = String(quilt.minecraft?.environment ?? "").toLowerCase();
    if (environment === "client") {
      declaration.side = "client";
      declaration.sideSource = "quilt.mod.json: minecraft.environment=client";
    } else if (environment === "dedicated_server") {
      declaration.side = "server";
    } else if (environment === "*") {
      declaration.side = "both";
    }
    const depends = Array.isArray(quilt.quilt_loader.depends)
      ? quilt.quilt_loader.depends
      : [];
    const minecraft = depends.find(
      (item) => item && typeof item === "object" && item.id === "minecraft",
    );
    declaration.mcRange = minecraft?.versions ?? null;
    declaration.mcGrammar = "semver";
    return declaration;
  }
  for (const [name, loader] of [
    ["META-INF/neoforge.mods.toml", "neoforge"],
    ["META-INF/mods.toml", "forge"],
  ]) {
    const raw = get(name);
    if (!raw) continue;
    declaration.loader = loader;
    const sides = [];
    for (const block of tomlBlocks(raw)) {
      if (!block.header.startsWith("dependencies.")) continue;
      const modId = tomlValue(block.body, "modId");
      if (modId === "minecraft") {
        declaration.mcRange ??= tomlValue(block.body, "versionRange");
        declaration.mcGrammar = "maven";
      }
      if (["minecraft", "forge", "neoforge"].includes(modId)) {
        const side = tomlValue(block.body, "side");
        if (side) sides.push(side.toUpperCase());
      }
    }
    if (sides.length > 0 && sides.every((side) => side === "CLIENT")) {
      declaration.side = "client";
      declaration.sideSource = `${name}: dependency side=CLIENT`;
    } else if (sides.length > 0) {
      declaration.side = sides.includes("SERVER") ? "server" : "both";
    }
    return declaration;
  }
  const legacy = get("mcmod.info") ? safeJson(get("mcmod.info")) : null;
  const first = Array.isArray(legacy)
    ? legacy[0]
    : Array.isArray(legacy?.modList)
      ? legacy.modList[0]
      : null;
  if (first) {
    declaration.loader = "forge";
    if (first.clientSideOnly === true) {
      declaration.side = "client";
      declaration.sideSource = "mcmod.info: clientSideOnly=true";
    }
    if (first.mcversion) {
      declaration.mcRange = `[${first.mcversion}]`;
      declaration.mcGrammar = "maven";
    }
  }
  return declaration;
}

async function inspectModJar(jarPath) {
  const [metadata, entries] = await Promise.all([
    readModMetadata(jarPath),
    readTextEntries(jarPath, DECLARATION_ENTRIES).catch(() => new Map()),
  ]);
  return { ...metadata, ...readDeclaration(entries) };
}

async function mapLimited(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await work(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/* ---- Pack statements ----------------------------------------------------- */

function parseKeyValueLines(raw) {
  const values = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function yamlScalar(raw, key) {
  return (
    new RegExp(`^\\s*${key}\\s*:\\s*["']?([^"'\\n#]*?)["']?\\s*(?:#.*)?$`, "im")
      .exec(raw)?.[1]
      ?.trim() || null
  );
}

function loaderFromCurseForge(manifest) {
  const configured =
    (manifest?.minecraft?.modLoaders || []).find((loader) => loader.primary) ||
    manifest?.minecraft?.modLoaders?.[0];
  const match = /^(neoforge|neo-forge|forge|fabric|quilt)[-_](.+)$/i.exec(
    String(configured?.id || ""),
  );
  if (!match) return null;
  return { type: normalizeLoaderName(match[1]), version: match[2] };
}

function loaderFromModrinth(dependencies = {}) {
  for (const [key, type] of [
    ["fabric-loader", "fabric"],
    ["quilt-loader", "quilt"],
    ["neoforge", "neoForge"],
    ["forge", "forge"],
  ]) {
    if (dependencies[key]) return { type, version: String(dependencies[key]) };
  }
  return null;
}

/* ---- Bare jars ----------------------------------------------------------- */

async function detectJar(jarPath) {
  const source = await openZipSource(jarPath);
  const names = new Set(source.entries.map((entry) => entry.path));
  const texts = await source.readText([
    ...DECLARATION_ENTRIES,
    "version.json",
    "install_profile.json",
  ]);
  const evidence = [];
  const warnings = [];
  const name = path.basename(jarPath, path.extname(jarPath));
  const declaration = readDeclaration(texts);
  let role = "unknown";
  let loader = null;
  let minecraftVersion = null;
  if (declaration.loader) {
    role = "mod";
    loader = { type: normalizeLoaderName(declaration.loader), version: null };
    evidence.push({
      field: "kind",
      value: "mod",
      source: "mod descriptor",
      detail: declaration.loader,
    });
    warnings.push(
      warning(
        "PACK_BARE_JAR_MOD",
        "This jar is a mod, not a server. Add it on a server's Mods tab instead.",
      ),
    );
  } else {
    const versionJson = texts.get("version.json")
      ? safeJson(texts.get("version.json"))
      : null;
    const id = String(versionJson?.id || "");
    if (texts.has("install_profile.json") || names.has("data/client.lzma")) {
      role = "installer";
      const forgeId = /^(1\.\d+(?:\.\d+)?)-forge-(.+)$/.exec(id);
      const neoId = /^neoforge-(.+)$/.exec(id);
      if (forgeId) {
        loader = { type: "forge", version: forgeId[2] };
        minecraftVersion = forgeId[1];
      } else if (neoId) {
        loader = { type: "neoForge", version: neoId[1] };
        minecraftVersion = minecraftFromNeoForge(neoId[1]);
      }
    } else if (
      names.has("net/minecraft/server/Main.class") ||
      names.has("net/minecraft/bundler/Main.class") ||
      names.has("META-INF/versions.list")
    ) {
      role = "serverJar";
      loader = { type: "vanilla", version: null };
      minecraftVersion = mcFromText(id) || null;
    }
    if (role !== "unknown") {
      evidence.push({
        field: "kind",
        value: role,
        source: "jar contents",
        detail: id || undefined,
      });
    }
    warnings.push(
      warning(
        "PACK_BARE_JAR",
        "A single jar is not a server pack. Use a modpack archive, or the existing-folder option for a server you already have.",
      ),
    );
  }
  return {
    kind: "bareJar",
    jarRole: role,
    name,
    root: "",
    format: "jar",
    loader,
    minecraftVersion,
    modCount: role === "mod" ? 1 : 0,
    modCheck: { checked: 0, incompatible: 0 },
    memory: null,
    javaMajor: null,
    port: null,
    packEulaAccepted: false,
    clientOnlyMods: [],
    disabledMods: [],
    missing: [],
    unfetchable: [],
    alternatives: [],
    warnings,
    evidence,
    sizeBytes: source.totalBytes,
  };
}

/* ---- The main detection -------------------------------------------------- */

async function detectPackContents(source, packPath, options) {
  const { requiredJavaMajorForMinecraft } = require("./sources.cjs");
  const prefix = wrapperPrefix(source.entries);
  const files = source.entries
    .filter((entry) => !entry.directory)
    .map((entry) => ({
      ...entry,
      rel: entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : null,
    }))
    .filter((entry) => entry.rel);
  const relPaths = files.map((entry) => entry.rel);
  const lower = new Map(relPaths.map((rel) => [rel.toLowerCase(), rel]));
  const has = (name) => lower.has(name.toLowerCase());
  const dirs = new Set();
  for (const rel of relPaths) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirs.add(parts.slice(0, i).join("/").toLowerCase());
    }
  }
  const evidence = [];
  const warnings = [];
  const addEvidence = (field, value, sourceName, detail) =>
    evidence.push({ field, value, source: sourceName, ...(detail ? { detail } : {}) });
  const name = path.basename(packPath, path.extname(packPath));

  /* Which text files to read, decided from the listing so the archive is opened
     once for all of them. */
  const rootScripts = relPaths.filter(
    (rel) => SCRIPT_NAME.test(rel) && SERVER_SCRIPT_NAME.test(rel),
  );
  const wantedText = [
    "variables.txt",
    "server-setup-config.yaml",
    "user_jvm_args.txt",
    "server.properties",
    "eula.txt",
    "overrides/eula.txt",
    "server-overrides/eula.txt",
    "modrinth.index.json",
    "manifest.json",
    ...rootScripts,
  ]
    .filter(has)
    .map((rel) => prefix + lower.get(rel.toLowerCase()));
  const texts = await source.readText(wantedText);
  const text = (rel) => {
    const real = lower.get(rel.toLowerCase());
    return real ? (texts.get((prefix + real).toLowerCase()) ?? null) : null;
  };

  /* ---- format and server evidence ------------------------------------ */
  const strong = [];
  const weak = [];
  const dirNames = (loaderPath) => {
    const marker = `${loaderPath}/`.toLowerCase();
    return [...dirs].filter((dir) => `${dir}/`.startsWith(marker));
  };
  if (dirNames("libraries/net/neoforged").length) {
    strong.push("libraries/net/neoforged");
  }
  if (dirNames("libraries/net/minecraftforge").length) {
    strong.push("libraries/net/minecraftforge");
  }
  if (dirNames("libraries/net/fabricmc").length) {
    strong.push("libraries/net/fabricmc");
  }
  if (dirNames("libraries/org/quiltmc").length) {
    strong.push("libraries/org/quiltmc");
  }
  if (dirs.has(".fabric")) strong.push(".fabric");
  for (const marker of [
    "variables.txt",
    "user_jvm_args.txt",
    "server-setup-config.yaml",
    "fabric-server-launch.jar",
  ]) {
    if (has(marker)) strong.push(marker);
  }
  for (const rel of rootScripts) strong.push(rel);
  for (const marker of ["server.properties", "eula.txt"]) {
    if (has(marker)) weak.push(marker);
  }
  const modJars = relPaths.filter(
    (rel) => /^mods\/.+\.jar$/i.test(rel) && !/\.disabled$/i.test(rel),
  );
  const modrinthIndex = text("modrinth.index.json")
    ? safeJson(text("modrinth.index.json"))
    : null;
  const curseManifest = text("manifest.json")
    ? safeJson(text("manifest.json"))
    : null;
  const isModrinth = modrinthIndex?.game === "minecraft";
  const isCurseForge =
    Boolean(curseManifest?.minecraft?.version) &&
    Array.isArray(curseManifest?.files);

  let kind;
  let format = "generic";
  if (isModrinth) {
    kind = "mrpack";
    format = "modrinth";
    addEvidence("kind", "mrpack", "modrinth.index.json");
  } else if (strong.length > 0 || (weak.length > 0 && modJars.length > 0)) {
    kind = "serverPack";
    for (const marker of [...strong, ...weak]) {
      addEvidence("kind", "serverPack", marker, "server-side file present");
    }
  } else if (isCurseForge) {
    kind = "clientPack";
    format = "curseforge";
    addEvidence("kind", "clientPack", "manifest.json", "CurseForge manifest");
  } else {
    kind = "unknown";
  }
  if (prefix) addEvidence("root", prefix, "archive", "single top-level folder flattened");

  /* ---- what the pack states about versions ---------------------------- */
  const candidates = [];
  const statedMemory = [];
  const addCandidate = (rank, sourceName, loaderInfo, mc) =>
    candidates.push({
      rank,
      source: sourceName,
      loaderType: loaderInfo?.type ?? null,
      loaderVersion: loaderInfo?.version ?? null,
      mc: mc || null,
    });

  const variables = has("variables.txt")
    ? parseKeyValueLines(text("variables.txt") || "")
    : null;
  if (variables) {
    addCandidate(
      1,
      "variables.txt",
      variables.MODLOADER
        ? {
            type: normalizeLoaderName(variables.MODLOADER),
            version: variables.MODLOADER_VERSION || null,
          }
        : null,
      variables.MINECRAFT_VERSION,
    );
    const heap = parseHeapMb(variables.JAVA_ARGS);
    if (heap) statedMemory.push({ mb: heap, source: "variables.txt (JAVA_ARGS)" });
  }
  const starterConfig = has("server-setup-config.yaml")
    ? text("server-setup-config.yaml") || ""
    : null;
  if (starterConfig) {
    const loaderName = yamlScalar(starterConfig, "modLoader");
    addCandidate(
      1,
      "server-setup-config.yaml",
      loaderName
        ? {
            type: normalizeLoaderName(loaderName),
            version: yamlScalar(starterConfig, "modLoaderVersion"),
          }
        : null,
      yamlScalar(starterConfig, "minecraftVersion"),
    );
    const heap = parseHeapMb(yamlScalar(starterConfig, "javaArgs") || "");
    if (heap) {
      statedMemory.push({ mb: heap, source: "server-setup-config.yaml" });
    }
  }
  if (isModrinth) {
    addCandidate(
      2,
      "modrinth.index.json",
      loaderFromModrinth(modrinthIndex.dependencies),
      modrinthIndex.dependencies?.minecraft,
    );
  }
  if (isCurseForge) {
    addCandidate(
      2,
      "manifest.json",
      loaderFromCurseForge(curseManifest),
      curseManifest.minecraft.version,
    );
  }
  const libraryText = relPaths
    .filter((rel) => rel.toLowerCase().startsWith("libraries/"))
    .join("\n");
  for (const found of loaderFromInstalledPaths(libraryText)) {
    addCandidate(3, "libraries/", { type: found.type, version: found.version }, found.mc);
  }
  for (const rel of relPaths) {
    const rootJar =
      /^forge-(1\.\d+(?:\.\d+)?)-([\d.]+)(?:-[a-z]+)?\.jar$/i.exec(rel) ||
      null;
    if (rootJar) {
      addCandidate(3, rel, { type: "forge", version: rootJar[2] }, rootJar[1]);
    }
    const vanilla = /^minecraft_server\.(.+)\.jar$/i.exec(rel);
    if (vanilla) addCandidate(3, rel, null, mcFromText(vanilla[1]));
    if (rel.toLowerCase() === "fabric-server-launch.jar") {
      addCandidate(3, rel, { type: "fabric", version: null }, null);
    }
  }
  for (const rel of rootScripts) {
    const script = text(rel) || "";
    for (const found of loaderFromInstalledPaths(posix(script))) {
      addCandidate(3, rel, { type: found.type, version: found.version }, found.mc);
    }
    const heap = parseHeapMb(script);
    if (heap) statedMemory.push({ mb: heap, source: rel });
  }
  if (has("user_jvm_args.txt")) {
    const heap = parseHeapMb(text("user_jvm_args.txt") || "");
    if (heap) statedMemory.push({ mb: heap, source: "user_jvm_args.txt" });
  }
  const nameVersion = mcFromText(name);
  if (nameVersion) addCandidate(5, `file name "${name}"`, null, nameVersion);
  const nameLoader = normalizeLoaderName(
    /(neoforge|forge|fabric|quilt)/i.exec(name)?.[1],
  );
  if (nameLoader) addCandidate(5, `file name "${name}"`, { type: nameLoader, version: null }, null);

  /* ---- mod jars: count, side, declared game version ------------------- */
  const modCount = isModrinth
    ? (modrinthIndex.files || []).filter(
        (file) => file?.env?.server !== "unsupported",
      ).length +
      modJars.length
    : isCurseForge && modJars.length === 0
      ? curseManifest.files.length
      : modJars.length;
  let inspectedMods = [];
  let jarAccess = null;
  const toInspect = modJars.slice(0, MAX_INSPECTED_JARS).map((rel) => prefix + rel);
  try {
    if (toInspect.length > 0) {
      jarAccess = await source.materializeJars(toInspect, {
        maxJars: MAX_INSPECTED_JARS,
        maxBytes: MAX_INSPECTED_JAR_BYTES,
      });
      const resolved = modJars
        .slice(0, MAX_INSPECTED_JARS)
        .map((rel) => ({ rel, abs: jarAccess.resolve(prefix + rel) }))
        .filter((item) => item.abs);
      inspectedMods = await mapLimited(resolved, JAR_CONCURRENCY, async (item) => ({
        rel: item.rel,
        info: await inspectModJar(item.abs),
      }));
    }
  } finally {
    jarAccess?.cleanup();
  }
  if (modJars.length > inspectedMods.length) {
    warnings.push(
      warning(
        "PACK_MODS_UNINSPECTED",
        `Only ${inspectedMods.length} of ${modJars.length} mod jars were read; checks that depend on mod descriptors cover those only.`,
        { inspected: inspectedMods.length, total: modJars.length },
      ),
    );
  }

  const clientOnly = inspectedMods
    .filter((mod) => mod.info.side === "client")
    .map((mod) => ({
      file: mod.rel,
      modId: mod.info.modId,
      name: mod.info.name || mod.info.modId || path.posix.basename(mod.rel),
      declared: mod.info.sideSource,
    }));
  if (isModrinth) {
    for (const file of modrinthIndex.files || []) {
      if (file?.env?.server === "unsupported") {
        clientOnly.push({
          file: String(file.path || ""),
          modId: null,
          name: path.posix.basename(String(file.path || "")),
          declared: "modrinth.index.json: env.server=unsupported",
        });
      }
    }
  }

  /* The game version the mods themselves point at, when nothing else does. */
  const rangeVotes = new Map();
  let ranged = 0;
  for (const mod of inspectedMods) {
    if (!mod.info.mcRange) continue;
    const named = versionNamedByRange(mod.info.mcRange);
    if (!named) continue;
    ranged += 1;
    rangeVotes.set(named, (rangeVotes.get(named) || 0) + 1);
  }
  const topVote = [...rangeVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topVote && ranged >= 3 && topVote[1] / ranged >= 0.5) {
    addCandidate(4, `${topVote[1]} of ${ranged} mod jars`, null, topVote[0]);
  }

  /* Loader the mods are built for. */
  const loaderVotes = new Map();
  for (const mod of inspectedMods) {
    if (!mod.info.loader) continue;
    const type = normalizeLoaderName(mod.info.loader);
    loaderVotes.set(type, (loaderVotes.get(type) || 0) + 1);
  }
  const loaderFamily = (type) =>
    type === "neoForge" || type === "forge" ? "forgeFamily" : type;
  const familyVotes = new Map();
  for (const [type, count] of loaderVotes) {
    familyVotes.set(loaderFamily(type), (familyVotes.get(loaderFamily(type)) || 0) + count);
  }
  const topFamily = [...familyVotes.entries()].sort((a, b) => b[1] - a[1])[0];

  /* ---- resolve: the most authoritative statement wins ------------------ */
  const byRank = [...candidates].sort((a, b) => a.rank - b.rank);
  const mcStated = byRank.filter((candidate) => candidate.mc);
  const mcChoice = mcStated[0] || null;
  let minecraftVersion = mcChoice?.mc ?? null;
  if (mcChoice) {
    addEvidence("minecraftVersion", minecraftVersion, mcChoice.source);
    const disagreeing = mcStated.filter(
      (candidate) => !sameMc(candidate.mc, minecraftVersion),
    );
    if (disagreeing.length > 0) {
      const others = disagreeing.map((candidate) => ({
        value: candidate.mc,
        source: candidate.source,
      }));
      warnings.push(
        warning(
          "PACK_VERSION_CONFLICT",
          `The pack gives conflicting Minecraft versions. Using ${minecraftVersion} from ${mcChoice.source}; also found ${others
            .map((other) => `${other.value} (${other.source})`)
            .join(", ")}.`,
          {
            chosen: minecraftVersion,
            chosenSource: mcChoice.source,
            others,
          },
        ),
      );
      for (const other of others) {
        addEvidence("minecraftVersion", other.value, other.source, "disagrees");
      }
    }
    if (mcChoice.rank >= 4) {
      warnings.push(
        warning(
          "PACK_VERSION_INFERRED",
          `The pack does not state its Minecraft version. ${minecraftVersion} was inferred from ${mcChoice.source}; check it before continuing.`,
          { value: minecraftVersion, source: mcChoice.source },
        ),
      );
    }
  } else if (kind !== "bareJar") {
    warnings.push(
      warning(
        "PACK_NO_VERSION",
        "No Minecraft version could be read from this pack. Choose one before continuing; none was assumed.",
      ),
    );
  }

  const loaderStated = byRank.filter((candidate) => candidate.loaderType);
  const loaderChoice = loaderStated[0] || null;
  let loader = loaderChoice
    ? { type: loaderChoice.loaderType, version: loaderChoice.loaderVersion }
    : null;
  if (loaderChoice) {
    /* A source that names the loader but not its version should not hide the
       version another source gave for the same loader. */
    if (!loader.version) {
      const withVersion = loaderStated.find(
        (candidate) =>
          candidate.loaderType === loader.type && candidate.loaderVersion,
      );
      if (withVersion) loader.version = withVersion.loaderVersion;
    }
    addEvidence(
      "loader",
      loader.version ? `${loader.type} ${loader.version}` : loader.type,
      loaderChoice.source,
    );
    const disagreeing = loaderStated.filter(
      (candidate) =>
        candidate.rank < 5 && candidate.loaderType !== loader.type,
    );
    if (disagreeing.length > 0) {
      const others = disagreeing.map((candidate) => ({
        value: candidate.loaderType,
        source: candidate.source,
      }));
      warnings.push(
        warning(
          "PACK_LOADER_CONFLICT",
          `The pack names more than one loader. Using ${loader.type} from ${loaderChoice.source}; also found ${others
            .map((other) => `${other.value} (${other.source})`)
            .join(", ")}.`,
          { chosen: loader.type, chosenSource: loaderChoice.source, others },
        ),
      );
    }
    const sameLoaderVersions = loaderStated.filter(
      (candidate) =>
        candidate.loaderType === loader.type &&
        candidate.loaderVersion &&
        candidate.loaderVersion !== loader.version,
    );
    if (sameLoaderVersions.length > 0) {
      const others = sameLoaderVersions.map((candidate) => ({
        value: candidate.loaderVersion,
        source: candidate.source,
      }));
      warnings.push(
        warning(
          "PACK_LOADER_VERSION_CONFLICT",
          `The pack names more than one ${loader.type} version. Using ${loader.version}; also found ${others
            .map((other) => `${other.value} (${other.source})`)
            .join(", ")}.`,
          { chosen: loader.version, others },
        ),
      );
    }
  } else if (topFamily && topFamily[0] !== "forgeFamily") {
    loader = { type: topFamily[0], version: null };
    addEvidence("loader", loader.type, `${topFamily[1]} mod jars`, "inferred");
  }
  if (loader && !loader.version && loader.type !== "vanilla" && kind !== "bareJar") {
    warnings.push(
      warning(
        "PACK_LOADER_VERSION_UNSTATED",
        `The pack does not state a ${loader.type} version; the newest one for Minecraft ${minecraftVersion || "?"} will be installed.`,
        { loader: loader.type },
      ),
    );
  }

  /* Mods against the chosen loader and game version. */
  if (loader && topFamily && inspectedMods.length >= 3) {
    const expected = loaderFamily(loader.type);
    const wrong = inspectedMods.filter(
      (mod) =>
        mod.info.loader &&
        loaderFamily(normalizeLoaderName(mod.info.loader)) !== expected,
    );
    if (wrong.length > 0) {
      warnings.push(
        warning(
          "PACK_MODS_LOADER_MISMATCH",
          `${wrong.length} mod jar(s) are built for a different loader than ${loader.type}.`,
          {
            loader: loader.type,
            count: wrong.length,
            examples: wrong.slice(0, 5).map((mod) => path.posix.basename(mod.rel)),
          },
        ),
      );
    }
  }
  const modCheck = { checked: 0, incompatible: 0 };
  if (minecraftVersion) {
    const incompatible = inspectedMods.filter(
      (mod) =>
        mod.info.mcRange &&
        satisfiesMinecraft(mod.info.mcRange, minecraftVersion, mod.info.mcGrammar) ===
          false,
    );
    const checked = inspectedMods.filter((mod) => mod.info.mcRange).length;
    modCheck.checked = checked;
    modCheck.incompatible = incompatible.length;
    if (incompatible.length > 0) {
      warnings.push(
        warning(
          "PACK_MODS_INCOMPATIBLE",
          `${incompatible.length} of ${checked} mod jars declare they do not support Minecraft ${minecraftVersion}.`,
          {
            count: incompatible.length,
            checked,
            version: minecraftVersion,
            examples: incompatible
              .slice(0, 5)
              .map((mod) => mod.info.name || path.posix.basename(mod.rel)),
          },
        ),
      );
    }
    if (checked > 0) {
      addEvidence(
        "mods",
        `${checked - incompatible.length} of ${checked} declare support for ${minecraftVersion}`,
        "mod descriptors",
      );
    }
  }

  /* ---- Java, memory, port ---------------------------------------------- */
  let javaMajor = minecraftVersion
    ? requiredJavaMajorForMinecraft(minecraftVersion)
    : null;
  if (javaMajor) addEvidence("java", String(javaMajor), `Minecraft ${minecraftVersion}`);
  const statedJava = variables?.RECOMMENDED_JAVA_VERSION
    ? Number.parseInt(variables.RECOMMENDED_JAVA_VERSION, 10)
    : null;
  if (statedJava && Number.isFinite(statedJava) && statedJava !== javaMajor) {
    addEvidence("java", String(statedJava), "variables.txt", "pack recommends");
    if (javaMajor) {
      warnings.push(
        warning(
          "PACK_JAVA_CONFLICT",
          `The pack recommends Java ${statedJava} but Minecraft ${minecraftVersion} needs Java ${javaMajor}. Using ${javaMajor}.`,
          { stated: statedJava, required: javaMajor },
        ),
      );
    } else {
      javaMajor = statedJava;
    }
  }

  const totalMemoryBytes = options.totalMemoryBytes ?? os.totalmem();
  const statedBest = statedMemory.sort((a, b) => b.mb - a.mb)[0] || null;
  const memory = recommendMemory({
    modCount,
    totalMemoryMb: Math.floor(totalMemoryBytes / MIB),
    statedMaxMb: statedBest?.mb ?? null,
  });
  memory.statedSource = statedBest?.source ?? null;
  addEvidence(
    "memory",
    `${memory.maxMb} MB`,
    memory.source === "pack" ? memory.statedSource : `${modCount} mods`,
    memory.totalMb ? `machine has ${memory.totalMb} MB` : undefined,
  );
  if (memory.capped) {
    warnings.push(
      warning(
        "PACK_MEMORY_CAPPED",
        `This pack wants about ${memory.wantMb} MB but the machine has ${memory.totalMb} MB, so ${memory.maxMb} MB is used to leave headroom. Expect lag with this many mods.`,
        { wantMb: memory.wantMb, maxMb: memory.maxMb, totalMb: memory.totalMb },
      ),
    );
  }

  let port = null;
  if (has("server.properties")) {
    const stated = Number.parseInt(
      parseKeyValueLines(text("server.properties") || "")["server-port"],
      10,
    );
    if (Number.isInteger(stated) && stated > 0 && stated < 65536) {
      port = { value: stated, source: "server.properties" };
      addEvidence("port", String(stated), "server.properties");
    }
  }

  /* The pack may ship its own accepted eula.txt; its settings are kept. */
  const packEulaAccepted = [
    "eula.txt",
    "overrides/eula.txt",
    "server-overrides/eula.txt",
  ].some((rel) => /^\s*eula\s*=\s*true\s*$/im.test(text(rel) || ""));
  if (packEulaAccepted) addEvidence("eula", "true", "eula.txt");

  /* ---- client-only mods ------------------------------------------------ */
  if (clientOnly.length > 0) {
    warnings.push(
      warning(
        "PACK_CLIENT_ONLY_MODS",
        `${clientOnly.length} mod(s) declare they only run on the client and will be disabled: ${clientOnly
          .slice(0, 5)
          .map((mod) => mod.name)
          .join(", ")}.`,
        {
          count: clientOnly.length,
          names: clientOnly.map((mod) => mod.name),
        },
      ),
    );
    for (const mod of clientOnly) {
      addEvidence("clientOnly", mod.name, mod.declared);
    }
  }
  const disabledMods = clientOnly
    .map((mod) => mod.file)
    .filter((file) => /^mods\/.+\.jar$/i.test(file));

  /* ---- client packs ---------------------------------------------------- */
  const missing = [];
  const unfetchable = [];
  if (kind === "clientPack") {
    const hasKey =
      options.curseForgeKeyPresent ?? Boolean(process.env.CURSEFORGE_API_KEY);
    missing.push("serverFiles");
    if (!hasKey) {
      for (const file of curseManifest.files) {
        const projectId = String(file.projectID ?? file.projectId ?? "");
        unfetchable.push({
          provider: "curseforge",
          projectId,
          fileId: String(file.fileID ?? file.fileId ?? ""),
          reason: "noApiKey",
        });
      }
    }
    warnings.push(
      warning(
        "PACK_CLIENT_PACK",
        "This is a client pack: it lists mods to download but contains no server files. Look for the pack's own server pack, which is the better choice.",
        { modCount: curseManifest.files.length },
      ),
    );
    if (unfetchable.length > 0) {
      warnings.push(
        warning(
          "PACK_MODS_NOT_FETCHABLE",
          `${unfetchable.length} mod(s) cannot be downloaded automatically because no CurseForge API key is configured. Download them by hand, or use the pack's server pack.`,
          { count: unfetchable.length },
        ),
      );
    }
  }

  const modsOnly = kind === "unknown" && modJars.length > 0;
  if (kind === "unknown") {
    warnings.push(
      warning(
        "PACK_UNRECOGNIZED",
        modsOnly
          ? "This archive holds mod jars but no server files, so it is not a server pack."
          : "This archive has no recognised server-pack files.",
      ),
    );
  }

  return {
    kind,
    format,
    name: String(
      modrinthIndex?.name || curseManifest?.name || name,
    ),
    root: prefix,
    loader,
    minecraftVersion,
    modCount,
    modCheck,
    memory,
    javaMajor,
    port,
    packEulaAccepted,
    clientOnlyMods: clientOnly,
    disabledMods,
    missing,
    unfetchable,
    alternatives: [],
    warnings,
    evidence,
    sizeBytes: source.totalBytes,
  };
}

/* A folder of downloads: several archives, one of which is the server pack.
   Takes the server pack when there is one and lists the rest. */
async function detectFolderOfPacks(directory, options) {
  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:zip|mrpack)$/i.test(entry.name))
    .slice(0, 8);
  const results = [];
  for (const entry of candidates) {
    try {
      results.push({
        file: path.join(directory, entry.name),
        plan: await detectPack(path.join(directory, entry.name), options),
      });
    } catch {
      /* One unreadable archive does not hide the others. */
    }
  }
  return results;
}

async function detectPack(packPath, options = {}) {
  const resolved = path.resolve(String(packPath || ""));
  if (!packPath || !fs.existsSync(resolved)) {
    throw provisioningError(
      "PACK_NOT_FOUND",
      "The selected modpack file does not exist.",
    );
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile() && /\.jar$/i.test(resolved)) {
    return detectJar(resolved);
  }
  const source = stat.isDirectory()
    ? openDirectorySource(resolved)
    : await openZipSource(resolved);
  const plan = await detectPackContents(source, resolved, options);
  if (stat.isDirectory() && plan.kind === "unknown") {
    const found = await detectFolderOfPacks(resolved, options);
    const preferred =
      found.find((item) => item.plan.kind === "serverPack") ||
      found.find((item) => item.plan.kind === "mrpack") ||
      null;
    if (preferred) {
      return {
        ...preferred.plan,
        sourcePath: preferred.file,
        alternatives: found
          .filter((item) => item !== preferred)
          .map((item) => ({ file: item.file, kind: item.plan.kind })),
        evidence: [
          {
            field: "kind",
            value: preferred.plan.kind,
            source: path.basename(preferred.file),
            detail: "server pack preferred over other archives in the folder",
          },
          ...preferred.plan.evidence,
        ],
      };
    }
  }
  return plan;
}

/* Applied after extraction: a disabled mod keeps its file, so it can be turned
   back on from the Mods tab (the same `.jar.disabled` convention). */
function applyDisabledMods(stagingDir, disabledMods) {
  const applied = [];
  for (const rel of disabledMods || []) {
    const target = path.resolve(stagingDir, ...String(rel).split("/"));
    const inside = path.relative(path.resolve(stagingDir), target);
    if (inside.startsWith("..") || path.isAbsolute(inside)) continue;
    if (!fs.existsSync(target)) continue;
    fs.renameSync(target, `${target}.disabled`);
    applied.push(rel);
  }
  return applied;
}

module.exports = {
  applyDisabledMods,
  detectPack,
  recommendMemory,
  satisfiesMinecraft,
};
