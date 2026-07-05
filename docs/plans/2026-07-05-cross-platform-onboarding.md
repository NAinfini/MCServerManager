# Cross Platform Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish Windows, Linux, and macOS builds, and add a real first-run setup checklist that detects Java, server.jar, EULA, and backup status without doing those actions for the user.

**Architecture:** Keep setup detection in the Electron backend so the renderer receives one explicit status document per server. Render the checklist in server settings and create/review flows as guidance only. Expand GitHub Actions release into platform-specific jobs that publish Electron artifacts and updater metadata.

**Tech Stack:** Electron, electron-builder, GitHub Actions, React, TypeScript, Vitest, SQLite-backed Electron backend.

---

### Task 1: Cross-platform release workflow

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `package.json`
- Test: `electron/release-workflows.test.mjs`

**Steps:**
1. Add failing tests that require Windows, Linux, and macOS release jobs and artifact config.
2. Update release workflow to use platform jobs for `--win`, `--linux`, and `--mac`.
3. Add electron-builder `mac` and `linux` targets and platform artifact names.
4. Run release workflow tests.

### Task 2: Backend setup status

**Files:**
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/electron-security.test.mjs`

**Steps:**
1. Add failing backend tests for `get_server_setup_status`.
2. Detect Java compatibility from existing runtime logic.
3. Detect `server.jar`, `eula.txt`, `eula=true`, and backup existence.
4. Add the command to preload allowlist and security test.

### Task 3: Frontend checklist

**Files:**
- Create: `src/features/servers/ServerSetupChecklist.tsx`
- Create: `src/features/servers/setupApi.ts`
- Modify: `src/features/servers/ServerDetail.tsx`
- Modify: `src/features/servers/ServerDetail.test.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/styles.css`

**Steps:**
1. Add failing UI tests for actionable checklist status.
2. Render Done / Action needed / Warning rows.
3. Keep actions instructional; do not auto-download or accept EULA.
4. Add English and Chinese translations.

### Task 4: Docs and verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `PRODUCT.md`
- Modify: `PRODUCT.zh-CN.md`

**Steps:**
1. Document Windows/Linux/macOS assets and unsigned macOS caveat.
2. Document first-run checklist behavior and non-automation boundaries.
3. Run typecheck, tests, build, and package smoke checks.
