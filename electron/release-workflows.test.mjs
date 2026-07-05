import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readWorkspaceFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Electron CI and release workflows", () => {
  it("does not run removed Tauri or Cargo release steps", () => {
    const ci = readWorkspaceFile(".github/workflows/ci.yml");
    const release = readWorkspaceFile(".github/workflows/release.yml");

    expect(`${ci}\n${release}`).not.toMatch(/src-tauri|tauri-action|cargo\s/i);
  });

  it("publishes Electron artifacts to GitHub Releases for app updates", () => {
    const release = readWorkspaceFile(".github/workflows/release.yml");

    expect(release).toContain("permissions:");
    expect(release).toContain("contents: write");
    expect(release).toMatch(/electron-builder\s+--win\s+--publish\s+always/);
    expect(release).toMatch(/electron-builder\s+--linux\s+--publish\s+always/);
    expect(release).toMatch(/electron-builder\s+--mac\s+--publish\s+always/);
    expect(release).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  });

  it("builds release artifacts on Windows, Linux, and macOS runners", () => {
    const release = readWorkspaceFile(".github/workflows/release.yml");

    expect(release).toContain("windows-latest");
    expect(release).toContain("ubuntu-latest");
    expect(release).toContain("macos-latest");
    expect(release).toContain("version: 9.15.9");
    expect(release).toContain("CSC_IDENTITY_AUTO_DISCOVERY: false");
  });

  it("uses stable platform artifact names that match updater metadata", () => {
    const manifest = JSON.parse(readWorkspaceFile("package.json"));

    expect(manifest.build.win.artifactName).toBe(
      "MC-Server-Manager-Setup-${version}.${ext}",
    );
    expect(manifest.build.linux.target).toEqual(["AppImage", "deb"]);
    expect(manifest.build.linux.artifactName).toBe(
      "MC-Server-Manager-${version}-${arch}.${ext}",
    );
    expect(manifest.build.mac.target).toEqual(["dmg", "zip"]);
    expect(manifest.build.mac.artifactName).toBe(
      "MC-Server-Manager-${version}-${arch}.${ext}",
    );
  });

  it("keeps pnpm overrides where release CI reads them", () => {
    const manifest = JSON.parse(readWorkspaceFile("package.json"));

    expect(manifest.pnpm?.overrides?.dompurify).toBe("3.4.11");
  });

  it("defines package maintainer metadata required by Linux deb builds", () => {
    const manifest = JSON.parse(readWorkspaceFile("package.json"));

    expect(manifest.author).toMatchObject({
      name: "NAinfini",
      email: "na.infini@gmail.com",
    });
  });

  it("does not package Electron test files into release artifacts", () => {
    const manifest = JSON.parse(readWorkspaceFile("package.json"));

    expect(manifest.build.files).toContain("!electron/*.test.mjs");
  });
});
