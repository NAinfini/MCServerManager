"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_READ_BYTES = 512 * 1024;

function readTail(file) {
  const { size } = fs.statSync(file);
  const length = Math.min(size, MAX_READ_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString("utf8");
}

function newestCrashReport(root, sinceMs) {
  const dir = path.join(root, "crash-reports");
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let newest = null;
  for (const name of names) {
    if (!name.endsWith(".txt")) continue;
    const file = path.join(dir, name);
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs >= sinceMs && (!newest || mtimeMs > newest.mtimeMs))
      newest = { file, name, mtimeMs };
  }
  return newest;
}

function linesAfter(text, pattern, count) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return "";
  return lines
    .slice(index, index + count)
    .map((line) => line.replace(/^\[[^\]]*\]\s*(\[[^\]]*\]\s*)*:?\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/* Fabric names a failed entrypoint by mod id, not by file. Only a single jar
   whose name starts with that id is claimed; otherwise the id alone is shown. */
function jarForModId(root, modId) {
  const wanted = modId.toLowerCase().replace(/[^a-z0-9]/g, "");
  let names;
  try {
    names = fs.readdirSync(path.join(root, "mods"));
  } catch {
    return null;
  }
  const matches = names.filter(
    (name) =>
      /\.jar$/i.test(name) &&
      name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(wanted),
  );
  return matches.length === 1 ? matches[0] : null;
}

/* Reads what the server left behind and says why it ended, in terms a person can
   act on. `deterministic` means starting it again cannot help. Only claims what
   the report states; anything else stays "unknown" with the report's name. */
function explainServerCrash({ root, sinceMs = 0 }) {
  const report = newestCrashReport(root, sinceMs);
  const reportText = report ? readTail(report.file) : "";
  const logFile = path.join(root, "logs", "latest.log");
  let logText = "";
  try {
    if (fs.statSync(logFile).mtimeMs >= sinceMs) logText = readTail(logFile);
  } catch {
    // No log yet: the JVM may have died before logging started.
  }
  const text = `${reportText}\n${logText}`;
  const base = { reportFile: report ? `crash-reports/${report.name}` : null };

  if (
    /for invalid dist DEDICATED_SERVER/.test(text) ||
    /in environment type SERVER/.test(text)
  ) {
    const modPath = /Mod File:\s*(\S+\.jar)/.exec(reportText)?.[1];
    const modName = /Failure message:\s*(.+?)\s*\([^)]*\)\s*has failed/.exec(
      reportText,
    )?.[1];
    return {
      ...base,
      kind: "clientOnlyMod",
      deterministic: true,
      modFile: modPath ? path.posix.basename(modPath.replace(/\\/g, "/")) : null,
      modName: modName ?? null,
      detail: "",
    };
  }
  // Fabric has no dist check: a client-only mod's entrypoint just fails on a
  // missing client class, usually without writing a crash report.
  const fabricEntrypoint =
    /Could not execute entrypoint stage '[^']+' due to errors, provided by '([^']+)'/.exec(
      text,
    );
  if (
    fabricEntrypoint &&
    /Caused by: java\.lang\.(NoClassDefFoundError|ClassNotFoundException): net[./]minecraft[./]client[./]/.test(
      text,
    )
  ) {
    return {
      ...base,
      kind: "clientOnlyMod",
      deterministic: true,
      modFile: jarForModId(root, fabricEntrypoint[1]),
      modName: fabricEntrypoint[1],
      detail: "",
    };
  }
  if (/UnsupportedClassVersionError|compiled by a more recent version of the Java/.test(text))
    return { ...base, kind: "javaVersion", deterministic: true, detail: "" };
  const dependency =
    /Incompatible mods? (found|set)|Missing or unsupported mandatory dependencies|Some of your mods are incompatible/;
  if (dependency.test(text))
    return {
      ...base,
      kind: "modIncompatible",
      deterministic: true,
      detail: linesAfter(logText || reportText, dependency, 8),
    };
  if (/OutOfMemoryError/.test(text))
    return { ...base, kind: "outOfMemory", deterministic: false, detail: "" };
  if (/FAILED TO BIND TO PORT|Address already in use/.test(text))
    return { ...base, kind: "portInUse", deterministic: false, detail: "" };
  if (/You need to agree to the EULA/.test(text))
    return { ...base, kind: "eula", deterministic: true, detail: "" };
  return { ...base, kind: "unknown", deterministic: false, detail: "" };
}

module.exports = { explainServerCrash };
