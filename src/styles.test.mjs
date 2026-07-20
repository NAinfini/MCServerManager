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
  it("loads the preview fidelity layers in dependency order", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const imports = [
      'import "./styles.css";',
      'import "./styles/preview/tokens.css";',
      'import "./styles/preview/shell.css";',
      'import "./styles/preview/components.css";',
      'import "./styles/preview/pages.css";',
    ];

    let previousIndex = -1;
    for (const statement of imports) {
      const index = app.indexOf(statement);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

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

describe("preview workbench sizing", () => {
  it("keeps Java and settings inline, full-width, and resistant to text clipping", () => {
    const pages = readFileSync(
      resolve(process.cwd(), "src/styles/preview/pages.css"),
      "utf8",
    );
    const components = readFileSync(
      resolve(process.cwd(), "src/styles/preview/components.css"),
      "utf8",
    );

    expect(pages).toMatch(/\.java-page,\s*\.settings-page\s*\{[^}]*max-width:\s*none/s);
    expect(pages).toMatch(/\.settings-row\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(pages).toMatch(/\.java-managed-install\s*\{[^}]*width:\s*fit-content/s);
    expect(components).toMatch(/--preview-control-height/);
    expect(components).toMatch(/:focus-visible/);
  });

  it("uses a stable one-to-two Java grid with full-width status panels", () => {
    const pages = readFileSync(
      resolve(process.cwd(), "src/styles/preview/pages.css"),
      "utf8",
    );

    expect(pages).toMatch(
      /\.java-layout\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*1fr\)\s+minmax\(0,\s*2fr\)/s,
    );
    expect(pages).toMatch(
      /\.java-panel-compatibility,\s*\.java-panel-failures\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(pages).not.toMatch(/\.java-layout\s*>\s*\.java-panel:nth-child/);
  });

  it("does not apply normal button height to switches or checkboxes", () => {
    const components = readFileSync(
      resolve(process.cwd(), "src/styles/preview/components.css"),
      "utf8",
    );

    expect(components).toMatch(
      /button:where\(:not\(\.switch-root\):not\(\.checkbox-root\)\),\s*\.button\s*\{[^}]*min-height:\s*var\(--preview-button-height\)/s,
    );
    expect(components).not.toMatch(/^button,\s*\.button\s*\{/m);
    expect(components).toMatch(
      /\.switch-root\[data-pointer-focus="true"\]:focus-visible\s*\{[^}]*outline:\s*none/s,
    );
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

describe("create server main content layout", () => {
  it("keeps marketplace pages within the available main content height", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(css).not.toMatch(/\.create-server-dialog\s*\{/s);
    expect(css).toMatch(
      /\.page-create-server\s*\{[^}]*\boverflow:\s*hidden[^}]*\bpadding:\s*0/s,
    );
    expect(css).toMatch(/\.create-server-page\s*\{[^}]*\bheight:\s*100%/s);
    expect(css).toMatch(/\.create-server-panel\s*\{[^}]*\bflex:\s*1 1 auto/s);
    expect(css).toMatch(/\.wizard-marketplace-step\s*\{[^}]*\bheight:\s*100%/s);
    expect(css).toMatch(/\.create-marketplace\s*\{[^}]*\bheight:\s*100%/s);
  });

  it("uses responsive marketplace cards with content-sized rows and square artwork", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const previewPages = readFileSync(
      resolve(process.cwd(), "src/styles/preview/pages.css"),
      "utf8",
    );
    const previewComponents = readFileSync(
      resolve(process.cwd(), "src/styles/preview/components.css"),
      "utf8",
    );
    const grid = extractCssBlock(css, ".marketplace-card-grid");
    const card = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-pack-card",
    );
    const media = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-pack-card-media",
    );
    const image = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-pack-card-media img",
    );

    expect(grid).toMatch(
      /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(grid).toMatch(/grid-auto-rows:\s*max-content/);
    expect(grid).toMatch(/align-content:\s*start/);
    expect(card).toMatch(
      /grid-template-columns:\s*96px\s+minmax\(0,\s*1fr\)/,
    );
    expect(media).toMatch(/width:\s*96px/);
    expect(media).toMatch(/height:\s*96px/);
    expect(media).toMatch(/aspect-ratio:\s*1/);
    expect(image).toMatch(/object-fit:\s*contain/);
    expect(previewPages).toMatch(
      /@media \(max-width:\s*1500px\)[\s\S]*?\.marketplace-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/,
    );
    expect(previewPages).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.marketplace-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(previewComponents).toMatch(
      /button:where\(:not\(\.switch-root\):not\(\.checkbox-root\)\)/,
    );
    expect(css).not.toMatch(/marketplace-featured-banner/);
  });

  it("keeps dynamic marketplace feedback in the vertical flow", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const marketplace = extractCssBlock(css, ".create-marketplace");
    const layout =
      css.match(/(?:^|\r?\n)\.create-marketplace-layout\s*\{([^}]*)\}/s)?.[1] ??
      "";

    expect(marketplace).toMatch(/display:\s*flex/);
    expect(marketplace).toMatch(/flex-direction:\s*column/);
    expect(marketplace).not.toMatch(/grid-template-rows/);
    expect(layout).toMatch(/flex:\s*1\s+1\s+auto/);
  });

  it("uses real card padding instead of overflowing the artwork track", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const resultCard = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-result",
    );
    const resultIcon = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-result-icon",
    );
    const packCard = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-pack-card",
    );
    const packMedia = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-pack-card-media",
    );

    for (const card of [resultCard, packCard]) {
      expect(card).toMatch(/gap:\s*var\(--space-3\)/);
      expect(card).toMatch(/padding:\s*var\(--space-3\)/);
    }
    for (const media of [resultIcon, packMedia]) {
      expect(media).not.toMatch(/margin-left/);
    }
  });

  it("does not compress marketplace version cards below their content height", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const versionList =
      css.match(/\.marketplace-version-list-compact\s*\{([^}]*)\}/s)?.[1] ?? "";
    const versionCard =
      [...css.matchAll(/\.marketplace-install-version\s*\{([^}]*)\}/gs)].at(
        -1,
      )?.[1] ?? "";
    const versionContent =
      css.match(/\.marketplace-install-version span\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(versionList).toMatch(/grid-auto-rows:\s*max-content/);
    expect(versionCard).toMatch(/height:\s*auto/);
    expect(versionCard).toMatch(/align-items:\s*flex-start/);
    expect(versionContent).toMatch(/gap:\s*4px/);
  });

  it("keeps marketplace screenshots compact without a nested scrollbar", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const gallery =
      css.match(/\.marketplace-pack-gallery\s*\{([^}]*)\}/s)?.[1] ?? "";
    const bodyImage =
      css.match(/\.marketplace-pack-body img\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(gallery).toMatch(/grid-auto-flow:\s*row/);
    expect(gallery).toMatch(/overflow:\s*visible/);
    expect(bodyImage).toMatch(/height:\s*auto/);
    expect(bodyImage).toMatch(/max-height:\s*min\(320px,\s*40vh\)/);
  });

  it("gives project details an immersive hero and structured statistics band", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const hero =
      css.match(/\.marketplace-project-hero\s*\{([^}]*)\}/s)?.[1] ?? "";
    const stats =
      css.match(/\.marketplace-project-stats\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(hero).toMatch(/position:\s*relative/);
    expect(hero).toMatch(/overflow:\s*hidden/);
    expect(stats).toMatch(/display:\s*grid/);
    expect(stats).toMatch(
      /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(130px,\s*1fr\)\)/,
    );
  });

  it("uses an editorial screenshot grid and readable project copy width", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const gallery =
      css.match(/\.marketplace-project-gallery-grid\s*\{([^}]*)\}/s)?.[1] ?? "";
    const about =
      css.match(/\.marketplace-project-about\s*\{([^}]*)\}/s)?.[1] ?? "";
    const heading =
      css.match(/\.marketplace-pack-body h1\s*\{([^}]*)\}/s)?.[1] ?? "";
    const galleryImage = extractCssBlock(css, ".marketplace-pack-gallery img");

    expect(gallery).toMatch(/grid-template-columns:\s*repeat\(2,/);
    expect(gallery).toMatch(/grid-auto-rows:\s*max-content/);
    expect(gallery).toMatch(/overflow:\s*visible/);
    expect(galleryImage).toMatch(/height:\s*auto/);
    expect(galleryImage).toMatch(/object-fit:\s*contain/);
    expect(about).toMatch(/max-width:\s*76ch/);
    expect(heading).toMatch(/font-size:\s*clamp/);
  });

  it("keeps the version rail usable at wide and narrow widths", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const grid =
      css.match(/\.marketplace-pack-detail-grid\s*\{([^}]*)\}/s)?.[1] ?? "";
    const loggerStyles = css.slice(css.indexOf(".logger-page"));
    const narrow = extractCssBlock(
      loggerStyles,
      "@media (max-width: 1100px)",
    );
    const focus =
      css.match(
        /\.marketplace-install-version:focus-visible\s*\{([^}]*)\}/s,
      )?.[1] ?? "";

    expect(grid).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(300px,\s*340px\)/,
    );
    expect(narrow).toMatch(
      /\.marketplace-pack-detail-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(narrow).toMatch(
      /\.marketplace-pack-version-sidebar\s*\{[^}]*order:\s*-1/s,
    );
    expect(focus).toMatch(/border-color:\s*var\(--accent\)/);
  });

  it("gives detail mode a definite height chain for independent scrolling", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const root =
      css.match(/\.create-marketplace\s*\{([^}]*)\}/s)?.[1] ?? "";
    const layout =
      css.match(/\.create-marketplace-layout-detail\s*\{([^}]*)\}/s)?.[1] ?? "";
    const article =
      css.match(/\.marketplace-detail-view\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(root).toMatch(/display:\s*flex/);
    expect(root).toMatch(/flex-direction:\s*column/);
    expect(layout).toMatch(/height:\s*100%/);
    expect(article).toMatch(/height:\s*100%/);
  });

  it("wraps unbroken remote project and version text safely", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const title =
      css.match(/\.marketplace-pack-detail-title h2\s*\{([^}]*)\}/s)?.[1] ?? "";
    const description =
      css.match(/\.marketplace-project-identity p\s*\{([^}]*)\}/s)?.[1] ?? "";
    const version =
      css.match(/\.marketplace-install-version strong\s*\{([^}]*)\}/s)?.[1] ??
      "";

    expect(title).toMatch(/overflow-wrap:\s*anywhere/);
    expect(description).toMatch(/overflow-wrap:\s*anywhere/);
    expect(version).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("lays out wizard progress compactly inside the main content header", () => {
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
        /\.create-server-wizard-header\s+\.create-server-page-title-row\s*>\s*div\s*\{([^}]*)\}/s,
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
      /\.create-server-wizard-header\s+\.wizard-step-label\s*\{[^}]*display:\s*none/s,
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

  it("keeps managed Java consent readable and the install action compact", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const consent =
      css.match(/\.java-managed-consent\s*\{([^}]*)\}/s)?.[1] ?? "";
    const install =
      css.match(/\.java-managed-install\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(consent).toMatch(/display:\s*flex/);
    expect(consent).toMatch(/gap:\s*8px/);
    expect(consent).toMatch(/min-width:\s*0/);
    expect(install).toMatch(/justify-self:\s*start/);
    expect(install).toMatch(/width:\s*fit-content/);
  });
});

describe("server detail workspace layout", () => {
  it("allows server metadata and console rails to shrink without clipping", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const detail = extractCssBlock(css, ".detail-panel");
    const metadata = extractCssBlock(css, ".detail-panel-meta");
    const consoleWorkspace = extractCssBlock(css, ".console-workspace");

    expect(detail).toMatch(/min-width:\s*0/);
    expect(detail).toMatch(/min-height:\s*0/);
    expect(metadata).toMatch(/flex-wrap:\s*wrap/);
    expect(consoleWorkspace).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(consoleWorkspace).toMatch(/min-height:\s*0/);
  });
});

describe("responsive text and control spacing", () => {
  it("keeps the preview shell single-column below the mobile breakpoint", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/styles/preview/shell.css"),
      "utf8",
    );
    const narrow = extractCssBlock(shell, "@media (max-width: 900px)");

    expect(narrow).toMatch(
      /\.app-body,\s*\.app-body-sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(narrow).toMatch(
      /\.runtime-bar,\s*\.sidebar,\s*\.page\s*\{[^}]*grid-column:\s*1/s,
    );
  });

  it("hides wizard labels at narrow widths without a specificity override", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const narrow = extractCssBlock(css, "@media (max-width: 480px)");

    expect(narrow).toMatch(
      /\.create-server-wizard-header \.wizard-step-label\s*\{[^}]*display:\s*none/s,
    );
    expect(narrow).not.toMatch(
      /\.create-server-wizard-header \.wizard-step-label\s*\{[^}]*display:\s*block/s,
    );
  });

  it("lets status-bar groups and labels shrink without wrapping", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const bar = extractCssBlock(css, ".status-bar");
    const groups = extractCssBlock(css, ".status-bar-left,");
    const item = extractCssBlock(css, ".status-bar-item");

    expect(bar).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/,
    );
    expect(groups).toMatch(/min-width:\s*0/);
    expect(item).toMatch(/min-width:\s*0/);
    expect(item).toMatch(/overflow:\s*hidden/);
    expect(item).toMatch(/text-overflow:\s*ellipsis/);
    expect(item).toMatch(/white-space:\s*nowrap/);
  });

  it("stacks console rails and task actions at narrow widths", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const narrow = extractCssBlock(css, "@media (max-width: 900px)");

    expect(narrow).toMatch(
      /\.console-workspace,\s*\.task-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(narrow).toMatch(
      /\.task-item-actions\s*\{[^}]*grid-row:\s*auto[^}]*flex-wrap:\s*wrap/s,
    );
  });

  it("preserves the intended sidebar toggle geometry", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const toggle = extractCssBlock(css, ".sidebar-toggle-button");
    const collapsed = extractCssBlock(
      css,
      ".sidebar-collapsed .sidebar-toggle-button",
    );

    expect(toggle).toMatch(/height:\s*30px/);
    expect(toggle).toMatch(/min-height:\s*30px/);
    expect(collapsed).toMatch(/height:\s*32px/);
    expect(collapsed).toMatch(/min-height:\s*32px/);
  });

  it("uses aligned block feedback and flattens embedded settings panels", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const wizardError = extractCssBlock(
      css,
      ".wizard-step-content > .form-error",
    );
    const settingsError = extractCssBlock(css, ".settings-error,");
    const embeddedPanel =
      css.match(
        /(?:^|\r?\n)\.settings-content > \.settings-panel\s*\{([^}]*)\}/s,
      )?.[1] ?? "";

    expect(wizardError).toMatch(/margin:\s*0\s+var\(--space-6\)/);
    expect(wizardError).toMatch(/overflow-wrap:\s*anywhere/);
    expect(settingsError).toMatch(/margin:\s*0\s+0\s+var\(--space-4\)/);
    expect(settingsError).toMatch(/padding:\s*var\(--space-3\)/);
    expect(embeddedPanel).toMatch(/border:\s*0/);
    expect(embeddedPanel).toMatch(/box-shadow:\s*none/);
  });
});

describe("application logger workspace sizing", () => {
  it("fills the remaining height with a list-first wide layout", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const page = extractCssBlock(css, ".logger-page");
    const workspace = extractCssBlock(css, ".app-log-workspace");
    const list = extractCssBlock(css, ".app-log-list");
    const detail = extractCssBlock(css, ".app-log-detail-pane");
    const narrow = extractCssBlock(css, "@media (max-width: 1100px)");

    expect(page).toMatch(/height:\s*100%/);
    expect(page).toMatch(
      /grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/,
    );
    expect(page).toMatch(/overflow:\s*hidden/);
    expect(workspace).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(320px,\s*2fr\)/,
    );
    expect(workspace).toMatch(/height:\s*100%/);
    expect(workspace).toMatch(/min-height:\s*0/);
    expect(list).toMatch(/height:\s*100%/);
    expect(list).toMatch(/max-height:\s*none/);
    expect(detail).toMatch(/height:\s*100%/);
    expect(detail).toMatch(/overflow:\s*auto/);
    expect(narrow).toMatch(
      /\.logger-page\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s,
    );
    expect(narrow).toMatch(
      /\.app-log-list\s*\{[^}]*height:\s*auto[^}]*max-height:\s*340px/s,
    );
    expect(narrow).toMatch(
      /\.app-log-detail-pane\s*\{[^}]*height:\s*auto/s,
    );
  });
});

describe("contextual modpack marketplace layout", () => {
  it("uses the large card grid while editing an existing server", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/marketplace/ServerMarketplaceView.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const resultCard = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-result",
    );
    const resultIcon = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-result-icon",
    );
    const resultImage = extractCssBlock(
      css,
      ".marketplace-card-grid .marketplace-result-icon img",
    );

    expect(source).toMatch(
      /contentType === "modpacks"[\s\S]*marketplace-results marketplace-card-grid/,
    );
    expect(resultCard).toMatch(
      /grid-template-columns:\s*96px\s+minmax\(0,\s*1fr\)/,
    );
    expect(resultIcon).toMatch(/width:\s*96px/);
    expect(resultIcon).toMatch(/height:\s*96px/);
    expect(resultIcon).toMatch(/aspect-ratio:\s*1/);
    expect(resultImage).toMatch(/object-fit:\s*contain/);
  });
});

describe("Overworld Studio shell contracts", () => {
  it("defines semantic surfaces and does not force a taller document than Electron", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const root = extractCssBlock(css, ":root");
    const body = extractCssBlock(css, "body");
    const appBody = extractCssBlock(css, ".app-body");
    const page = extractCssBlock(css, ".page");

    for (const token of [
      "--surface-canvas",
      "--surface-sidebar",
      "--surface-panel",
      "--surface-raised",
      "--accent-warm",
      "--focus-ring",
    ]) {
      expect(root).toContain(`${token}:`);
    }
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).not.toMatch(/min-height:\s*720px/);
    expect(appBody).toMatch(/min-height:\s*0/);
    expect(page).toMatch(/min-width:\s*0/);
    expect(page).toMatch(/min-height:\s*0/);
  });
});

describe("theme color contracts", () => {
  it("keeps subtle text readable on panel and input surfaces", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const themes = [
      extractCssBlock(css, ":root"),
      extractCssBlock(css, '[data-theme="light"]'),
    ];

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

  it("keeps the light titlebar and sidebar readable", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const light = extractCssBlock(css, '[data-theme="light"]');
    const lightChrome = readHexToken(light, "--bg-sidebar");

    for (const token of [
      "--text-main",
      "--text-muted",
      "--text-subtle",
      "--accent",
    ]) {
      const foreground = readHexToken(light, token);
      expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(foreground, lightChrome)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
