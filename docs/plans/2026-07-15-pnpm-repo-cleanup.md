# pnpm Repository Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reclaim obsolete repository storage and make pnpm installs reproducible without keeping a copied pnpm store inside the OneDrive workspace.

**Architecture:** Keep the existing hoisted pnpm dependency layout required by the Electron project, but pin pnpm 9.15.9 in `package.json` to match CI. Let pnpm use its normal external content-addressed store and automatic import method, then remove stale generated trees and unreachable Git recovery objects before reinstalling from the frozen lockfile.

**Tech Stack:** pnpm 9.15.9, Corepack, Git, Electron, Vitest, PowerShell.

---

### Task 1: Pin pnpm and prevent repository-local dependency duplication

**Files:**
- Modify: `electron/release-workflows.test.mjs`
- Modify: `package.json`
- Modify: `.npmrc`

**Step 1: Add a failing package-manager configuration test**

Add this test to `electron/release-workflows.test.mjs`:

```js
it("pins one pnpm version without a repository-local copied store", () => {
  const manifest = JSON.parse(readWorkspaceFile("package.json"));
  const npmrc = readWorkspaceFile(".npmrc");
  const ci = readWorkspaceFile(".github/workflows/ci.yml");
  const release = readWorkspaceFile(".github/workflows/release.yml");

  expect(manifest.packageManager).toBe("pnpm@9.15.9");
  expect(ci).toContain("version: 9.15.9");
  expect(release).toContain("version: 9.15.9");
  expect(npmrc).toContain("node-linker=hoisted");
  expect(npmrc).not.toMatch(/store-dir|package-import-method/);
});
```

**Step 2: Run the focused test and verify it fails**

Run: `pnpm vitest run electron/release-workflows.test.mjs --testTimeout 15000`

Expected: FAIL because `packageManager` is absent and `.npmrc` still contains `store-dir` and `package-import-method`.

**Step 3: Apply the minimal pnpm configuration change**

Add this top-level field to `package.json`:

```json
"packageManager": "pnpm@9.15.9"
```

Replace `.npmrc` with:

```ini
node-linker=hoisted
```

Do not change `pnpm-lock.yaml`, the existing `pnpm.overrides`, or CI workflow versions.

**Step 4: Run the focused test and verify it passes**

Run: `pnpm vitest run electron/release-workflows.test.mjs --testTimeout 15000`

Expected: PASS.

**Step 5: Commit the configuration change**

```powershell
git add .npmrc package.json electron/release-workflows.test.mjs
git commit -m "Configure pnpm without a local copied store"
```

### Task 2: Remove generated dependency and build trees

**Files:**
- Remove ignored directories only: `node_modules`, `.pnpm-store`, `dist`, `release`, `artifacts`, `tmp`

**Step 1: Verify the worktree and target paths**

Run: `git status --short`

Expected: no output after Task 1's commit.

Resolve every cleanup target beneath the repository root before deletion. Abort if any resolved path is outside that root.

**Step 2: Delete only the approved ignored directories**

Use native PowerShell `Remove-Item -LiteralPath -Recurse -Force` for each verified absolute target. Do not enumerate paths in one shell and pass them to another shell. Do not remove any source, documentation, configuration, lockfile, or `.git` path.

**Step 3: Verify tracked files remain unchanged**

Run: `git status --short`

Expected: no output.

### Task 3: Prune obsolete Git recovery objects

**Files:**
- Mutate Git metadata only: `.git/logs`, `.git/objects`

**Step 1: Check repository integrity before pruning**

Run: `git fsck --full`

Expected: no missing or corrupt reachable objects. Dangling or unreachable object notices are acceptable before cleanup.

Run: `git count-objects -vH`

Expected: approximately 5.66 GiB of loose objects before cleanup.

**Step 2: Confirm no Git operation is active**

Verify that `git status --short` succeeds and that `.git` contains no active `*.lock`, rebase, merge, cherry-pick, or bisect state. Stop if any operation is active.

**Step 3: Expire recovery logs and prune unreachable objects**

Run:

```powershell
git reflog expire --expire=now --expire-unreachable=now --all
git gc --prune=now
```

Expected: unreachable loose objects are removed while all current refs and commits remain intact.

**Step 4: Verify Git integrity and reclaimed space**

Run: `git fsck --full`

Expected: no missing or corrupt objects.

Run: `git count-objects -vH`

Expected: loose object storage is near zero and packed reachable history remains small.

### Task 4: Reinstall and verify the Electron project

**Files:**
- Recreate ignored directory: `node_modules`
- Use external pnpm store selected by pnpm

**Step 1: Confirm the pinned pnpm version**

Run: `pnpm --version`

Expected: `9.15.9`.

**Step 2: Install exactly from the lockfile**

Run: `pnpm install --frozen-lockfile`

Expected: successful install without recreating `.pnpm-store` inside the repository and without modifying `pnpm-lock.yaml`.

**Step 3: Run the complete test suite**

Run: `pnpm vitest run --testTimeout 15000`

Expected: all tests pass.

**Step 4: Run the production build**

Run: `pnpm build`

Expected: TypeScript and Vite build complete successfully.

**Step 5: Perform final repository review**

Run: `git status --short`

Expected: no tracked changes.

Measure top-level directory sizes again. Confirm `.git` no longer contains the obsolete loose-object payload, `.pnpm-store` is absent, and only the reproducible `node_modules` and `dist` generated trees remain.

