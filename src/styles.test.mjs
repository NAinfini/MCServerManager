import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global focus styles", () => {
  it("draws focus only for keyboard-style focus-visible matches", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const focusVisibleBlocks = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g)];

    expect(css).not.toMatch(/(^|,)\s*:focus\s*(,|\{)/m);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
    expect(
      focusVisibleBlocks.some(([, , declarations]) =>
        /outline:\s*none/.test(declarations),
      ),
    ).toBe(false);
  });

  it("animates explicit properties and uses typographic loading ellipses", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const localePaths = ["src/i18n/locales/en.json", "src/i18n/locales/zh-CN.json"];
    const localeValues = localePaths.flatMap((path) =>
      Object.values(JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"))),
    );
    const loadingState = readFileSync(
      resolve(process.cwd(), "src/components/ui/loading-state.tsx"),
      "utf8",
    );
    const select = readFileSync(
      resolve(process.cwd(), "src/components/ui/select.tsx"),
      "utf8",
    );

    expect(css).not.toMatch(/transition:\s*all\b/);
    expect(localeValues.filter((value) => value.includes("..."))).toEqual([]);
    expect(loadingState).not.toContain('"Loading..."');
    expect(select).not.toContain('"Select..."');
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
