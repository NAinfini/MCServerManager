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

function backendErrorCodes() {
  const codes = new Set();
  for (const filePath of collectCjsFiles("electron")) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const match of source.matchAll(CODED_ERROR)) {
      codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

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

  it("carries the code across IPC, which drops custom Error properties", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toContain("taggedForRenderer");
    expect(main).toContain("[MCSM:");
  });
});
