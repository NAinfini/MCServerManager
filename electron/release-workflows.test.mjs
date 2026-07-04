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
    expect(release).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  });

  it("uses a stable installer artifact name that matches updater metadata", () => {
    const manifest = JSON.parse(readWorkspaceFile("package.json"));

    expect(manifest.build.artifactName).toBe(
      "MC-Server-Manager-Setup-${version}.${ext}",
    );
  });
});
