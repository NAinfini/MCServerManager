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

describe("sidebar brand geometry", () => {
  it("keeps the app mark square when the brand copy needs space", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const appMark = css.match(/\.app-mark\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(appMark).toMatch(/width:\s*38px/);
    expect(appMark).toMatch(/height:\s*38px/);
    expect(appMark).toMatch(/flex-shrink:\s*0/);
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

  it("lays out wizard progress compactly inside the dialog header", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const wizardHeader =
      css.match(/\.create-server-wizard-header\s*\{([^}]*)\}/s)?.[1] ?? "";
    const headerSteps =
      css.match(
        /\.create-server-wizard-header\s+\.wizard-steps\s*\{([^}]*)\}/s,
      )?.[1] ?? "";
    const headerConnector =
      css.match(
        /\.create-server-wizard-header\s+\.wizard-step-connector\s*\{([^}]*)\}/s,
      )?.[1] ?? "";
    const narrowWizardStyles =
      css.match(
        /@media\s*\(max-width:\s*480px\)\s*\{([\s\S]*?)\r?\n\}\r?\n\r?\n\.create-marketplace/,
      )?.[1] ?? "";

    expect(wizardHeader).toMatch(/display:\s*grid/);
    expect(wizardHeader).toMatch(
      /grid-template-columns:\s*minmax\(170px,\s*220px\)\s+minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(headerSteps).toMatch(/min-width:\s*0/);
    expect(headerSteps).toMatch(/padding:\s*0/);
    expect(headerSteps).toMatch(/border:\s*0/);
    expect(headerConnector).toMatch(/width:\s*clamp\(18px,\s*3vw,\s*36px\)/);
    expect(narrowWizardStyles).toMatch(
      /\.create-server-wizard-header\s+\.wizard-step-label\s*\{[^}]*display:\s*block/s,
    );
  });
});
