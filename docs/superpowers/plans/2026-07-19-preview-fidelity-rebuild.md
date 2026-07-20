# MC Server Manager Preview-Fidelity Rebuild Implementation Plan

> **For Codex:** Execute this plan task-by-task with the `executing-plans` skill. Use test-driven development for every behavior or structural change.

**Goal:** Rebuild the application shell and all primary workspaces so the running Electron renderer matches the approved balanced Minecraft/professional preview in both light and dark themes without changing backend or server-management contracts.

**Architecture:** Keep existing feature logic and state ownership. Introduce a small layered visual system (tokens, shell, shared components, pages), then make surgical semantic markup changes where CSS alone cannot express the approved structure. Reuse existing data only; do not add fake dashboard or activity data.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Electron, CSS.

---

## Task 1: Establish the visual system and stable application shell

**Files:**
- Create: `src/styles/preview/tokens.css`
- Create: `src/styles/preview/shell.css`
- Create: `src/styles/preview/components.css`
- Create: `src/styles/preview/pages.css`
- Modify: `src/styles.css`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/AppShell.test.tsx`
- Modify: `src/styles.test.mjs`

1. Add failing assertions for the four style-layer imports, stable expanded/collapsed sidebar contract, dashboard semantic regions, keyboard-only focus styling, and the approved control/image sizing tokens.
2. Run the targeted tests and confirm failure is caused by the missing structure/styles.
3. Add the four CSS layers and import them once from `styles.css` in dependency order.
4. Reshape the dashboard markup into a clear header and contained workbench with primary server content plus a supporting status rail populated only from existing state.
5. Preserve all sidebar navigation, grouping, drag/drop, theme, locale, and window controls.
6. Run targeted tests and verify both expanded and collapsed shells remain navigable.

## Task 2: Rebuild the server workspace and application logger

**Files:**
- Modify: `src/features/servers/ServerDetail.tsx`
- Modify: `src/features/servers/ServerDetail.test.tsx`
- Modify: `src/features/console/ConsoleView.tsx`
- Modify: `src/features/console/ConsoleView.test.tsx`
- Modify: `src/features/logger/AppLoggerView.tsx`
- Modify: `src/features/logger/AppLoggerView.test.tsx`
- Modify: `src/styles/preview/pages.css`

1. Add failing tests for a left-hand server section menu, bounded content pane, command suggestions/autofill, and the three-pane logger structure.
2. Run targeted tests and confirm the structural expectations fail.
3. Move server-detail navigation to a left rail while preserving the existing active section and controls.
4. Keep console command autofill visible, keyboard operable, and constrained to the command workspace.
5. Move logger severity filters into a left rail; retain log list and detail as separate panes with independent bounded scrolling.
6. Add responsive collapse rules for widths below 1100px without changing logger data/filter behavior.
7. Run targeted tests.

## Task 3: Rebuild create-server and marketplace flows

**Files:**
- Modify: `src/features/servers/CreateServerWizard.tsx`
- Modify: `src/features/servers/CreateServerWizard.test.tsx`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Modify: `src/features/marketplace/ServerMarketplaceView.tsx`
- Modify: `src/features/marketplace/ServerMarketplaceView.test.tsx`
- Modify: `src/styles/preview/pages.css`
- Modify: `src/styles.test.mjs`

1. Add failing tests for the inline six-step workbench, persistent header controls, single-column wide marketplace cards, square contained thumbnails, explicit loading/empty/error states, and no duplicate bottom “previous” action on browsing.
2. Run targeted tests and confirm expected failures.
3. Keep creation inside the main content area and preserve the exact source → compatibility → Java → configuration → EULA → install/start flow.
4. Render Modrinth and BBSMC results as wide one-column cards with 128px square contained media, metadata, server-pack warning state, and a right-side action area that wraps at narrow widths.
5. Keep market discovery visible while creating or editing a modpack server; preserve BBSMC direct-link/manual-download rules.
6. Ensure the results region fills available height without introducing nested full-page scrollbars.
7. Run targeted tests.

## Task 4: Rebuild Java, settings, themes, and shared responsive details

**Files:**
- Modify: `src/features/java/JavaRuntimesView.tsx`
- Modify: `src/features/java/JavaRuntimesView.test.tsx`
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/features/settings/SettingsView.test.tsx`
- Modify: `src/features/settings/ThemeSettings.tsx`
- Modify: `src/styles/preview/pages.css`
- Modify: `src/styles/preview/components.css`
- Modify: `src/styles.test.mjs`

1. Add failing tests for inline Java/settings pages, compact non-clipping controls, left settings section navigation, and theme controls that expose light/dark/system modes.
2. Run targeted tests.
3. Apply the shared workbench hierarchy to Java and settings without changing runtime installation, download consent, or persistence behavior.
4. Normalize form rows, buttons, notices, and card spacing; use 40px fields, 36px buttons, and wrapping text at narrow widths.
5. Ensure mouse clicks do not leave decorative focus rings while keyboard focus remains visible.
6. Run targeted tests.

## Task 5: Whole-application verification and visual acceptance

**Files:**
- Modify only files directly implicated by verified defects.

1. Run all unit tests with `pnpm vitest run`.
2. Run `pnpm build`.
3. Start one clean renderer instance on an unused port and inspect the dashboard, server workspace, create/market, Java, settings, and logger at 1280×720, 1440×900, and 1920×1080.
4. Repeat representative screens in light and dark mode. Verify no clipped text, horizontal page overflow, stretched thumbnails, duplicate actions, modal regressions, or uncontrolled nested scrolling.
5. Verify keyboard navigation and command autocomplete with real interactions.
6. Perform the mandatory post-change review: requirement completeness, correctness, side effects, performance, security, and maintainability.
7. Report any residual risk explicitly; do not claim completion unless tests, build, and inspected screens pass.
