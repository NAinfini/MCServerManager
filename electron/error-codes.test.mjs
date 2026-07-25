import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Backend errors reach the renderer as "[MCSM:CODE] English detail" and are
 * resolved against `desktop.error.<CODE>`. A code without a locale entry falls
 * back to raw English, which is exactly the gap this suite exists to close, so
 * the codes and the locale keys have to be checked against each other.
 */
const CODED_ERROR = new RegExp(
  String.raw`(?:codedError|provisioningError)\(\s*"([A-Z][A-Z0-9_]*)"`,
  "g",
);

function collectCjsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCjsFiles(filePath, files);
    } else if (entry.name.endsWith(".cjs")) {
      files.push(filePath);
    }
  }
  return files;
}

// trimRequired and stringFilePath derive their code from the message, which no
// static scan for a string literal can see. Reproduce the same derivation from
// the call sites so those codes are checked for translations too.
const REQUIRED_FIELD_CALL = new RegExp(
  String.raw`(?:trimRequired|stringFilePath)\(\s*[^;]{0,200}?"([^"]+?)"\s*[,)]`,
  "g",
);

function requiredFieldCodes(source) {
  const codes = [];
  for (const match of source.matchAll(REQUIRED_FIELD_CALL)) {
    const label = match[1];
    if (label.includes("<")) continue; // the doc comment's placeholder
    const field = /^(.+?)(?: is required)?$/.exec(label)[1];
    codes.push(`${field.replace(/\s+/g, "_").toUpperCase()}_REQUIRED`);
  }
  return codes;
}

function backendErrorCodes() {
  const codes = new Set();
  for (const filePath of collectCjsFiles("electron")) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const match of source.matchAll(CODED_ERROR)) {
      codes.add(match[1]);
    }
    for (const code of requiredFieldCodes(source)) {
      codes.add(code);
    }
  }
  return [...codes].sort();
}

// Errors that stay plain English on purpose. Each reports a wiring or contract
// bug rather than something a user can act on, so a translation would only bury
// the diagnostic. Anything not listed here must carry a code.
const UNTRANSLATED_BY_DESIGN = {
  "electron/backend.cjs": ["backend context is unavailable"],
  "electron/backend/command-registry.cjs": [
    "Unsupported Electron backend command",
  ],
  "electron/main.cjs": [
    "show_open_dialog requires kind",
    "Electron window is unavailable.",
    "Unsupported window action",
    "Unsupported Electron backend command",
    "app updater error",
  ],
  "electron/app-updater.cjs": ["app updater error"],
  "electron/provisioning/jobs.cjs": ["job store and id generator are required"],
  "electron/provisioning/loaders.cjs": [
    "loader download function is not configured",
    "loader process runner is not configured",
    "loader metadata clients are required",
  ],
  "electron/provisioning/runtimes.cjs": [
    "runtime user-data directory and metadata client are required",
  ],
};

function localeErrorCodes(locale) {
  const dictionary = JSON.parse(
    fs.readFileSync(`src/i18n/locales/${locale}.json`, "utf8"),
  );
  return Object.keys(dictionary)
    .filter((key) => /^desktop\.error\.[A-Z]/.test(key))
    .map((key) => key.slice("desktop.error.".length))
    .sort();
}

describe("backend error codes", () => {
  it("gives every coded backend error a translation in every locale", () => {
    const codes = backendErrorCodes();

    expect(codes.length).toBeGreaterThan(0);
    for (const locale of ["en", "zh-CN"]) {
      expect({ locale, codes: localeErrorCodes(locale) }).toEqual({
        locale,
        codes,
      });
    }
  });

  it("leaves no backend error uncoded except the listed internal assertions", () => {
    const stray = [];
    for (const filePath of collectCjsFiles("electron")) {
      const relative = filePath.split(path.sep).join("/");
      if (/\.test\.mjs$|ui-smoke\.cjs$/.test(relative)) continue;

      const allowed = UNTRANSLATED_BY_DESIGN[relative] || [];
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("throw new Error(")) return;
        // requiredFieldError() is the coded path; it falls back to a plain Error
        // only for a message shape it documents as unsupported.
        if (line.includes("requiredFieldError")) return;
        const rest = lines.slice(index, index + 3).join(" ");
        if (allowed.some((fragment) => rest.includes(fragment))) return;
        stray.push(`${relative}:${index + 1} ${line.trim()}`);
      });
    }

    expect(stray).toEqual([]);
  });

  it("carries the code across IPC, which drops custom Error properties", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toContain("taggedForRenderer");
    expect(main).toContain("[MCSM:");
  });
});
