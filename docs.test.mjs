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
});
