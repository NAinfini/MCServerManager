const { readTextEntries } = require("./archive.cjs");

/* Where a mod says what it is. Which file it uses is decided by its loader and
   by how old it is: Forge moved from `mcmod.info` to `META-INF/mods.toml` at
   1.13, NeoForge forked that again, and Bukkit-family plugins never used
   either. The list is ordered by specificity, and the manifest is last because
   it only ever resolves a `${file.jarVersion}` placeholder the TOML left. */
const METADATA_ENTRIES = [
  "fabric.mod.json",
  "quilt.mod.json",
  "META-INF/mods.toml",
  "META-INF/neoforge.mods.toml",
  "mcmod.info",
  "plugin.yml",
  "paper-plugin.yml",
  "META-INF/MANIFEST.MF",
];

const EMPTY = Object.freeze({ modId: null, name: null, version: null });

function text(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    /* A jar with a corrupt descriptor is not a reason to fail the whole content
       listing; it is one row that stays unknown, which is what it honestly is. */
    return null;
  }
}

function fromFabric(raw) {
  const data = parseJson(raw);
  if (!data) return null;
  return {
    modId: text(data.id),
    name: text(data.name),
    version: text(data.version),
  };
}

function fromQuilt(raw) {
  const loader = parseJson(raw)?.quilt_loader;
  if (!loader) return null;
  return {
    modId: text(loader.id),
    name: text(loader.metadata?.name),
    version: text(loader.version),
  };
}

/* `mcmod.info` is a JSON array of mods, occasionally wrapped in
   `{ modList: [...] }` by the 1.7.10-era build scripts. */
function fromMcmodInfo(raw) {
  const data = parseJson(raw);
  const first = Array.isArray(data)
    ? data[0]
    : Array.isArray(data?.modList)
      ? data.modList[0]
      : null;
  if (!first) return null;
  return {
    modId: text(first.modid),
    name: text(first.name),
    version: text(first.version),
  };
}

/* Read with a regex rather than a TOML parser on purpose: the packaged
   dependency list is deliberately two modules wide (see package.json), and the
   three keys wanted here are always plain quoted scalars inside the first
   `[[mods]]` table. Anything more exotic falls through to unknown rather than
   being guessed at. */
function fromModsToml(raw) {
  const body = raw.slice(raw.search(/^\s*\[\[mods\]\]/m));
  if (!body) return null;
  const value = (key) =>
    text(
      new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]*)["']`, "im").exec(
        body,
      )?.[1],
    );
  return {
    modId: value("modId"),
    name: value("displayName"),
    version: value("version"),
  };
}

/* Bukkit/Paper plugin descriptors. Same reasoning as the TOML above: the three
   keys are top-level scalars, so they are read directly instead of adding a
   YAML parser to the packaged runtime. */
function fromPluginYml(raw) {
  const value = (key) =>
    text(
      new RegExp(`^${key}\\s*:\\s*["']?([^"'\\n#]*)["']?`, "im")
        .exec(raw)?.[1]
        ?.trim(),
    );
  return {
    modId: value("name"),
    name: value("name"),
    version: value("version"),
  };
}

function manifestVersion(raw) {
  if (!raw) return null;
  /* Manifest values may continue on a following line that starts with a single
     space; joining those back is what makes a long version readable. */
  const joined = raw.replace(/\r?\n /g, "");
  return text(
    /^Implementation-Version\s*:\s*(.*)$/im.exec(joined)?.[1] ||
      /^Specification-Version\s*:\s*(.*)$/im.exec(joined)?.[1],
  );
}

/* Forge lets a mod write `${file.jarVersion}` in its TOML and have the loader
   substitute the manifest's Implementation-Version at runtime. Left as-is it
   reaches the content table verbatim, which is worse than unknown. */
function resolvePlaceholders(metadata, manifest) {
  if (!metadata?.version || !/^\$\{.*\}$/.test(metadata.version)) {
    return metadata;
  }
  return { ...metadata, version: manifestVersion(manifest) };
}

/* What a jar says about itself, or nulls. Never throws for a jar it cannot
   read: an unreadable descriptor is one unknown row, not a failed page. */
async function readModMetadata(jarPath) {
  let entries;
  try {
    entries = await readTextEntries(jarPath, METADATA_ENTRIES);
  } catch {
    return EMPTY;
  }
  const entry = (name) => entries.get(name.toLowerCase()) ?? null;
  const manifest = entry("META-INF/MANIFEST.MF");
  const candidates = [
    () =>
      entry("fabric.mod.json") ? fromFabric(entry("fabric.mod.json")) : null,
    () => (entry("quilt.mod.json") ? fromQuilt(entry("quilt.mod.json")) : null),
    () =>
      entry("META-INF/mods.toml")
        ? fromModsToml(entry("META-INF/mods.toml"))
        : null,
    () =>
      entry("META-INF/neoforge.mods.toml")
        ? fromModsToml(entry("META-INF/neoforge.mods.toml"))
        : null,
    () => (entry("mcmod.info") ? fromMcmodInfo(entry("mcmod.info")) : null),
    () => (entry("plugin.yml") ? fromPluginYml(entry("plugin.yml")) : null),
    () =>
      entry("paper-plugin.yml")
        ? fromPluginYml(entry("paper-plugin.yml"))
        : null,
  ];
  for (const read of candidates) {
    const metadata = resolvePlaceholders(read(), manifest);
    if (metadata?.modId || metadata?.version) {
      return {
        modId: metadata.modId ?? null,
        name: metadata.name ?? null,
        version: metadata.version ?? null,
      };
    }
  }
  /* No descriptor of any kind. The manifest still often carries the version,
     and a version alone is more than the table had before. */
  const version = manifestVersion(manifest);
  return version ? { ...EMPTY, version } : EMPTY;
}

module.exports = {
  METADATA_ENTRIES,
  readModMetadata,
};
