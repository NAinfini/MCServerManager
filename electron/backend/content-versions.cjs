const { codedError } = require("../provisioning/contracts.cjs");

function normalizeLoader(loader) {
  const value = String(loader || "")
    .toLowerCase()
    .replace(/-/g, "");
  return value === "neoforge" ? "neoForge" : value;
}

function compatibilityWarnings(version, profile) {
  const warnings = [];
  const loaders = (version.loaders || []).map(normalizeLoader);
  const supportedLoaders =
    profile.loaderType === "paper"
      ? ["paper", "spigot", "bukkit", "purpur"]
      : [profile.loaderType];
  if (
    profile.loaderType &&
    loaders.length &&
    !loaders.some((loader) => supportedLoaders.includes(loader))
  )
    warnings.push(
      `Requires ${loaders.join(" / ")}; server uses ${profile.loaderType}.`,
    );
  if (
    profile.minecraftVersion &&
    version.gameVersions?.length &&
    !version.gameVersions.includes(profile.minecraftVersion)
  )
    warnings.push(
      `Requires Minecraft ${version.gameVersions.join(" / ")}; server uses ${profile.minecraftVersion}.`,
    );
  return warnings;
}

function checkCompatibility(version, profile, installAnyway) {
  const warnings = compatibilityWarnings(version, profile);
  if (warnings.length && !installAnyway)
    throw codedError("CONTENT_INCOMPATIBLE", warnings.join(" "));
  return warnings;
}

function compareVersions(left, right) {
  const parse = (value) =>
    /^v?(\d+(?:\.\d+)*)(?:-([^+]+))?(?:\+.*)?$/.exec(String(value || ""));
  const a = parse(left),
    b = parse(right);
  if (!a || !b) return null;
  const ap = a[1].split(".").map(Number),
    bp = b[1].split(".").map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if ((ap[i] || 0) !== (bp[i] || 0)) return (ap[i] || 0) - (bp[i] || 0);
  }
  if (a[2] && !b[2]) return -1;
  if (!a[2] && b[2]) return 1;
  return a[2] === b[2] ? 0 : null;
}

function newestCompatibleVersion(
  versions,
  profile,
  currentVersionId,
  currentVersion,
) {
  const currentIndex = versions.findIndex(
    (version) =>
      version.id === currentVersionId || version.name === currentVersionId,
  );
  const current = versions[currentIndex];
  return versions.find((version, index) => {
    if (
      version.id === currentVersionId ||
      version.name === currentVersionId ||
      version.versionNumber === currentVersion ||
      compatibilityWarnings(version, profile).length
    )
      return false;
    const comparison = compareVersions(version.versionNumber, currentVersion);
    if (comparison !== null && comparison <= 0) return false;
    const published = Date.parse(version.publishedAt || version.createdAt);
    const currentPublished = Date.parse(
      current?.publishedAt || current?.createdAt,
    );
    if (Number.isFinite(published) && Number.isFinite(currentPublished))
      return published > currentPublished;
    // Provider lists are newest first. Stop at the installed release; skipping
    // it and taking the next entry was how the old checker offered downgrades.
    return currentIndex >= 0
      ? index < currentIndex
      : comparison !== null && comparison > 0;
  });
}

module.exports = {
  compatibilityWarnings,
  checkCompatibility,
  newestCompatibleVersion,
  compareVersions,
};
