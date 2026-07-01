import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global focus styles", () => {
  it("does not draw browser focus outlines", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const outlineDeclarations = css
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("outline:"));

    expect(css).toMatch(/:focus[^{]*\{[^}]*outline:\s*none/s);
    expect(outlineDeclarations.every((line) => line === "outline: none;")).toBe(
      true,
    );
  });
});

describe("create server modal layout", () => {
  it("keeps marketplace pages at a stable modal height", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(css).toMatch(/\.create-server-dialog\s*\{[^}]*\bheight:/s);
    expect(css).toMatch(/\.create-server-panel\s*\{[^}]*\bflex:\s*1 1 auto/s);
    expect(css).toMatch(/\.wizard-marketplace-step\s*\{[^}]*\bheight:\s*100%/s);
    expect(css).toMatch(/\.create-marketplace\s*\{[^}]*\bheight:\s*100%/s);
  });
});
