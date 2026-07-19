import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function extractCssBlock(css, marker) {
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) return "";
  const openingBrace = css.indexOf("{", markerIndex + marker.length);
  if (openingBrace === -1) return "";

  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  return "";
}

function readHexToken(block, token) {
  return block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(foreground, background, foregroundWeight) {
  const channels = (hex) =>
    hex
      .slice(1)
      .match(/.{2}/g)
      .map((channel) => Number.parseInt(channel, 16));
  const foregroundChannels = channels(foreground);
  const backgroundChannels = channels(background);
  return `#${foregroundChannels
    .map((channel, index) =>
      Math.round(
        channel * foregroundWeight +
          backgroundChannels[index] * (1 - foregroundWeight),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("global focus styles", () => {
  it("draws focus only for keyboard-style focus-visible matches", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const focusVisibleBlocks = [
      ...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g),
    ];

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
    const localePaths = [
      "src/i18n/locales/en.json",
      "src/i18n/locales/zh-CN.json",
    ];
    const localeValues = localePaths.flatMap((path) =>
      Object.values(
        JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")),
      ),
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
    const headerTitleCopy =
      css.match(
        /\.create-server-wizard-header\s+\.create-server-dialog-title-row\s*>\s*div\s*\{([^}]*)\}/s,
      )?.[1] ?? "";
    const headerDescription =
      css.match(/\.create-server-wizard-header\s+p\s*\{([^}]*)\}/s)?.[1] ?? "";
    const narrowWizardStyles = extractCssBlock(
      css,
      "@media (max-width: 480px)",
    );

    expect(wizardHeader).toMatch(/display:\s*grid/);
    expect(wizardHeader).toMatch(
      /grid-template-columns:\s*minmax\(170px,\s*220px\)\s+minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(headerSteps).toMatch(/min-width:\s*0/);
    expect(headerSteps).toMatch(/padding:\s*0/);
    expect(headerSteps).toMatch(/border:\s*0/);
    expect(headerConnector).toMatch(/width:\s*clamp\(18px,\s*3vw,\s*36px\)/);
    expect(headerTitleCopy).toMatch(/min-width:\s*0/);
    expect(headerDescription).toMatch(/white-space:\s*nowrap/);
    expect(headerDescription).toMatch(/overflow:\s*hidden/);
    expect(headerDescription).toMatch(/text-overflow:\s*ellipsis/);
    expect(narrowWizardStyles).toMatch(
      /\.create-server-wizard-header\s+\.wizard-step-label\s*\{[^}]*display:\s*block/s,
    );
  });
});

describe("java runtime panel layout", () => {
  it("keeps managed runtime content padded and able to wrap", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const panelBody = css.match(/\.java-panel-body\s*\{([^}]*)\}/s)?.[1] ?? "";
    const bodyActions =
      css.match(
        /\.java-panel-body\s*>\s*\.page-header-actions\s*\{([^}]*)\}/s,
      )?.[1] ?? "";

    expect(panelBody).toMatch(/display:\s*grid/);
    expect(panelBody).toMatch(/gap:\s*var\(--space-3\)/);
    expect(panelBody).toMatch(/min-width:\s*0/);
    expect(panelBody).toMatch(/padding:\s*var\(--space-4\)\s+var\(--space-5\)/);
    expect(bodyActions).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("theme color contracts", () => {
  it("keeps subtle text readable on panel and input surfaces", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const themes = [extractCssBlock(css, ":root"), extractCssBlock(css, '[data-theme="light"]')];

    for (const theme of themes) {
      const subtle = readHexToken(theme, "--text-subtle");
      expect(subtle).toMatch(/^#[0-9a-f]{6}$/i);
      for (const surfaceToken of ["--bg-panel", "--bg-elevated"]) {
        const surface = readHexToken(theme, surfaceToken);
        expect(contrastRatio(subtle, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("defines success and accessible light-theme metadata roles", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const root = extractCssBlock(css, ":root");

    expect(root).toMatch(/--success:\s*var\(--running\)/);
    for (const role of ["version", "provider", "source"]) {
      const block = extractCssBlock(
        css,
        `[data-theme="light"] .meta-badge-${role}`,
      );
      const foreground = readHexToken(block, "--meta-badge-color");
      const background = readHexToken(block, "--meta-badge-bg");

      expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps success text readable on plain and tinted surfaces", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const root = extractCssBlock(css, ":root");
    const light = extractCssBlock(css, '[data-theme="light"]');
    const themes = [
      {
        success: readHexToken(root, "--running"),
        panel: readHexToken(root, "--bg-panel"),
        elevated: readHexToken(root, "--bg-elevated"),
        muted: readHexToken(root, "--bg-panel-muted"),
      },
      {
        success: readHexToken(light, "--success"),
        panel: readHexToken(light, "--bg-panel"),
        elevated: readHexToken(light, "--bg-elevated"),
        muted: readHexToken(light, "--bg-panel-muted"),
      },
    ];

    for (const theme of themes) {
      expect(theme.success).toMatch(/^#[0-9a-f]{6}$/i);
      for (const surface of [
        theme.panel,
        theme.elevated,
        mixHex(theme.success, theme.muted, 0.1),
      ]) {
        expect(contrastRatio(theme.success, surface)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it("keeps retained dark chrome readable in the light theme", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const light = extractCssBlock(css, '[data-theme="light"]');
    const darkChrome = readHexToken(light, "--bg-sidebar");

    for (const selector of [".window-titlebar", ".sidebar"]) {
      const block = extractCssBlock(css, `[data-theme="light"] ${selector}`);
      for (const token of ["--text-main", "--text-muted", "--text-subtle", "--accent"]) {
        const foreground = readHexToken(block, token);
        expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrastRatio(foreground, darkChrome)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });
});
