# Release Readiness Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the reviewed data-safety, port-preflight, marketplace, keyboard-accessibility, desktop-smoke, and signing-readiness issues without expanding product scope.

**Architecture:** Keep validation in the Electron backend so renderer or IPC calls cannot bypass it. Make server start await a dependency-injected TCP port probe, keep CurseForge official APIs dormant while removing the broken user-facing discovery path, and enforce keyboard-only focus through `:focus-visible`. Verify the production renderer with a separate hidden Electron smoke harness and gate stable release publishing on signing credentials.

**Tech Stack:** Electron, Node.js, React, TypeScript, SQLite, Vitest, GitHub Actions.

---

### Task 1: Block unsafe world restore

**Files:**
- Modify: `electron/backend.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `src/features/backups/ServerBackupsView.tsx`
- Modify: `src/features/backups/ServerBackupsView.test.tsx`

**Step 1: Write the failing backend test**

Create a completed backup, start the server with the fake child process, and assert `restore_world_backup` throws an error with code `SERVER_MUST_BE_STOPPED`. Assert the existing target world file is unchanged.

**Step 2: Run the focused test and verify RED**

Run: `.\\node_modules\\.bin\\vitest.cmd run electron\\backend.test.mjs -t "rejects world restore while the server is running"`

Expected: FAIL because restore currently deletes and replaces the target.

**Step 3: Implement the backend guard**

Add a shared active-process predicate covering `managedChildren` and persisted `running` / `external_running` process rows. Throw a stable provisioning-style error before any restore filesystem mutation.

**Step 4: Write and run the UI RED test**

Pass a running server profile and assert the restore action is disabled with a visible stopped-server explanation. Verify the test fails before changing the component.

**Step 5: Implement the UI guard and verify GREEN**

Use the profile/runtime status already available to `ServerDetail`, or query process status in the backup view. Keep the backend guard authoritative.

**Step 6: Commit**

Commit message: `fix: block live world restores`

### Task 2: Preflight server ports before start

**Files:**
- Modify: `electron/backend.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `src/features/servers/ServerActions.test.tsx`
- Modify: `src/features/servers/ServerActions.tsx`

**Step 1: Write failing backend tests**

Inject `checkPortAvailable` into `createBackend`. Assert `start_server` rejects with `SERVER_PORT_IN_USE` and never calls the Java process spawner when the probe reports unavailable. Add a second test for another active managed profile configured on the same port.

**Step 2: Verify RED**

Run the two named backend tests and confirm the process spawner is currently called.

**Step 3: Implement minimal asynchronous preflight**

Add a per-database port checker dependency. The default checker temporarily binds a `node:net` server to `0.0.0.0:<port>`, closes it immediately, and maps `EADDRINUSE` / `EACCES` to actionable stable errors. Convert `startServer` to async and await the probe before spawning. Update crash restart, provisioning auto-start, restart, countdown, and scheduled-task call sites to await or handle the returned promise.

**Step 4: Add UI error coverage**

Assert a `SERVER_PORT_IN_USE` rejection is displayed next to the server start action rather than only appearing in raw logs.

**Step 5: Verify GREEN and commit**

Commit message: `fix: preflight server ports before launch`

### Task 3: Remove unavailable CurseForge discovery

**Files:**
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx`
- Modify: `src/features/settings/SettingsView.test.tsx`
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write failing UI tests**

Assert the creation marketplace provider selector contains Modrinth but not CurseForge. Assert settings describe CurseForge as manual import only and do not present an enable switch implying integrated discovery.

**Step 2: Verify RED**

Run the marketplace and settings tests; confirm current provider options expose CurseForge.

**Step 3: Implement UI and copy changes**

Narrow the creation provider type and query paths to Modrinth. Replace the settings switch with a non-interactive manual-import status row. Keep existing backend/preload commands dormant for later credential work.

**Step 4: Verify GREEN and commit**

Commit message: `fix: clarify manual CurseForge support`

### Task 4: Restore keyboard-only focus and UI contracts

**Files:**
- Modify: `src/styles.test.mjs`
- Modify: `src/styles.css`
- Modify: `src/i18n/index.test.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/components/ui/loading-state.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `PRODUCT.md`
- Modify: `PRODUCT.zh-CN.md`

**Step 1: Write failing contract tests**

Assert CSS does not reset plain `:focus`, defines a general `:focus-visible` indicator, and contains no `transition: all`. Assert applying light/dark themes sets `document.documentElement.style.colorScheme`. Assert user-visible locale values and shared defaults contain no ASCII loading ellipsis.

**Step 2: Verify RED**

Run style and i18n tests and confirm failures match the reviewed issues.

**Step 3: Implement the minimal UI fixes**

Remove the global `:focus` reset. Add an outline or ring only under `:focus-visible`, retaining specialized control rings. Replace the wizard circle transition with explicit properties. Set native `color-scheme` in `applyTheme`. Convert affected loading/placeholder strings to `…`. Update product accessibility wording.

**Step 4: Verify keyboard behavior**

Run component tests and the production Electron smoke; mouse clicks must not match `:focus-visible`, while keyboard Tab focus must have a non-zero visible outline or box shadow.

**Step 5: Commit**

Commit message: `fix: restore keyboard focus visibility`

### Task 5: Add a real production Electron UI smoke

**Files:**
- Create: `electron/ui-smoke.cjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `electron/release-workflows.test.mjs`

**Step 1: Write failing workflow/script contract tests**

Assert `package.json` exposes `test:electron-ui-smoke`, CI runs it after build on Windows and through `xvfb-run` on Linux, and release packaging excludes the smoke harness.

**Step 2: Verify RED**

Run `electron/release-workflows.test.mjs`; confirm the script and workflow commands are absent.

**Step 3: Implement the smoke harness**

Create a hidden, sandboxed BrowserWindow using the production `dist/index.html` and normal preload. Register narrow stub IPC responses for initial queries. In the renderer, verify the preload bridge, click the unique Create Server button, assert the dialog and six wizard steps, verify keyboard focus visibility, and exit 0. Add a hard timeout and diagnostic error output.

**Step 4: Run GREEN locally**

Run: `npm run build`

Run: `npm run test:electron-ui-smoke`

Expected: exit 0 with a concise success message.

**Step 5: Commit**

Commit message: `test: launch production Electron UI smoke`

### Task 6: Gate stable releases on signing credentials

**Files:**
- Modify: `electron/release-workflows.test.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write failing workflow tests**

Assert Windows stable publishing requires `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`. Assert macOS requires certificate and notarization secrets. Assert secret values are never printed.

**Step 2: Verify RED**

Run the workflow test and confirm current `CSC_IDENTITY_AUTO_DISCOVERY: false` unsigned publishing violates the contract.

**Step 3: Implement the release gate**

Map GitHub secrets to electron-builder variables in platform-specific publish steps. Add PowerShell preflight steps that report missing secret names only. Leave local `electron:build` usable without credentials and document the stable-release requirement.

**Step 4: Verify GREEN and commit**

Commit message: `ci: require signing for stable releases`

### Task 7: Final review and verification

**Files:**
- Review all files changed by Tasks 1-6.

**Step 1: Run focused regressions**

Run backend, backup, server-action, marketplace, settings, style, i18n, and workflow tests.

**Step 2: Run complete verification**

Run:

- `.\\node_modules\\.bin\\vitest.cmd run`
- `npm run build`
- `npm run test:electron-smoke`
- `npm run test:electron-ui-smoke`
- `git diff --check main...HEAD`

**Step 3: Perform mandatory review**

Confirm requirement completeness, correctness, side effects, performance, security, and maintainability. Confirm no CurseForge key is stored, no restore mutation precedes the stop guard, port probes always close, pointer focus stays visually quiet, and release logs expose no secrets.

**Step 4: Commit any test-only final adjustments**

Commit message: `test: cover release readiness hardening`
