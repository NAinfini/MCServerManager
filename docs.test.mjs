import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path) {
  return readFileSync(path, "utf8");
}

describe("project documentation", () => {
  it("keeps English and Chinese docs linked to each other", () => {
    const pairs = [
      ["README.md", "README.zh-CN.md"],
      ["PRODUCT.md", "PRODUCT.zh-CN.md"],
    ];

    for (const [english, chinese] of pairs) {
      expect(existsSync(english), `${english} should exist`).toBe(true);
      expect(existsSync(chinese), `${chinese} should exist`).toBe(true);
      expect(read(english)).toContain(`](${chinese})`);
      expect(read(chinese)).toContain(`](${english})`);
    }
  });

  it("ignores local Electron release review output directories", () => {
    const gitignore = read(".gitignore");

    expect(gitignore).toContain("release-review/");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");
    expect(gitignore).toContain("coverage/");
    expect(gitignore).toContain("*.tsbuildinfo");
  });

  it("starts the complete Electron application through pnpm dev", () => {
    const { scripts } = JSON.parse(read("package.json"));

    expect(scripts["dev:renderer"]).toBe("vite");
    expect(scripts.dev).toBe(
      'concurrently -k "pnpm dev:renderer" "wait-on http://localhost:1420 && electron ."',
    );
    expect(scripts["electron:dev"]).toBe("pnpm dev");
  });

  it("documents every development entry point in both READMEs", () => {
    const commands = ["pnpm dev", "pnpm dev:renderer", "pnpm electron:dev"];

    for (const path of ["README.md", "README.zh-CN.md"]) {
      const contents = read(path);

      for (const command of commands) {
        expect(contents, `${path} should document ${command}`).toMatch(
          new RegExp(`^${command}\\s*(?:#.*)?$`, "m"),
        );
      }
    }
  });

  it("documents the trusted automatic first-server workflow in both languages", () => {
    const englishDocs = `${read("README.md")}\n${read("PRODUCT.md")}`;
    const chineseDocs = `${read("README.zh-CN.md")}\n${read("PRODUCT.zh-CN.md")}`;

    for (const phrase of [
      "Modrinth and CurseForge",
      "Eclipse Temurin",
      "explicit EULA confirmation",
      "Vanilla, Paper, Forge, NeoForge, Fabric, and Quilt",
      "server-pack warning",
      "pack-provided scripts",
    ]) {
      expect(englishDocs).toContain(phrase);
    }
    for (const phrase of [
      "Modrinth 和 CurseForge",
      "Eclipse Temurin",
      "明确确认 EULA",
      "Vanilla、Paper、Forge、NeoForge、Fabric 和 Quilt",
      "服务端包警告",
      "整合包自带脚本",
    ]) {
      expect(chineseDocs).toContain(phrase);
    }
  });
});
