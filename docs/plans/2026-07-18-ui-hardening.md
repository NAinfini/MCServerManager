# UI Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove confirmed UI clipping, contrast, semantic, and keyboard-accessibility defects without changing server-management behavior.

**Architecture:** Keep fixes local to the affected React components, locale strings, and existing CSS tokens. Preserve current visual class names and data flow; add semantic wrappers and centralized context-menu focus management only where required.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS custom properties, Electron smoke tests.

---

### Task 1: Java managed-runtime panel layout

**Files:**
- Modify: `src/features/java/JavaRuntimesView.test.tsx`
- Modify: `src/features/java/JavaRuntimesView.tsx`
- Modify: `src/styles.test.mjs`
- Modify: `src/styles.css`

**Step 1: Write the failing tests**

Assert that the managed description, links, action, and install states are grouped by `.java-panel-body`. Add a CSS contract assertion requiring body padding, vertical gap, `min-width: 0`, and wrapping action controls.

**Step 2: Run tests to verify failure**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/styles.test.mjs`

Expected: FAIL because `.java-panel-body` does not exist.

**Step 3: Implement the minimal layout fix**

Wrap only the managed-runtime panel content below `.section-heading`. Style the wrapper with existing spacing tokens and make its action row wrap. Remove redundant nested compatibility-list outer padding within that body.

**Step 4: Run tests to verify success**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/styles.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/java/JavaRuntimesView.test.tsx src/features/java/JavaRuntimesView.tsx src/styles.test.mjs src/styles.css
git commit -m "fix: prevent java panel content clipping"
```

### Task 2: Theme contrast and success token

**Files:**
- Modify: `src/styles.test.mjs`
- Modify: `src/styles.css`

**Step 1: Write the failing tests**

Parse dark and light theme tokens and assert a contrast ratio of at least 4.5:1 for `--text-subtle` on its panel/input surfaces. Require `--success` in both theme scopes and light-theme overrides for version, provider, and source metadata badges.

**Step 2: Run test to verify failure**

Run: `pnpm vitest run src/styles.test.mjs`

Expected: FAIL for current subtle-text ratios, missing `--success`, and missing light badge overrides.

**Step 3: Implement the minimal token changes**

Choose theme-appropriate accessible colors, define `--success` from the existing state palette, and add scoped light-theme badge foreground/background/border values. Do not change unrelated color roles.

**Step 4: Run test to verify success**

Run: `pnpm vitest run src/styles.test.mjs`

Expected: PASS with computed ratios at or above 4.5:1.

**Step 5: Commit**

```bash
git add src/styles.test.mjs src/styles.css
git commit -m "fix: meet ui color contrast requirements"
```

### Task 3: View-toggle names and wizard semantics

**Files:**
- Modify: `src/components/layout/AppShell.test.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/features/servers/CreateServerWizard.test.tsx`
- Create: `src/features/servers/WizardStepIndicator.test.tsx`
- Modify: `src/features/servers/WizardStepIndicator.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/styles.css`

**Step 1: Write the failing tests**

Assert that both icon-only view buttons have distinct localized names. For the progress indicator, assert an ordered list, `aria-current="step"` on the active item, buttons only for completed navigable steps, and no disabled buttons.

**Step 2: Run tests to verify failure**

Run: `pnpm vitest run src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx src/features/servers/WizardStepIndicator.test.tsx`

Expected: FAIL for unnamed view buttons and disabled/non-list progress markup.

**Step 3: Implement accessible markup**

Add `servers.viewCards` and `servers.viewTable` translations and apply them as button labels. Change wizard progress to `ol`/`li`; use a button only for completed clickable steps and a non-interactive element otherwise. Preserve existing visual classes.

**Step 4: Run tests to verify success**

Run: `pnpm vitest run src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx src/features/servers/WizardStepIndicator.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/layout/AppShell.test.tsx src/components/layout/AppShell.tsx src/features/servers/CreateServerWizard.test.tsx src/features/servers/WizardStepIndicator.test.tsx src/features/servers/WizardStepIndicator.tsx src/i18n/locales/en.json src/i18n/locales/zh-CN.json src/styles.css
git commit -m "fix: improve wizard and view control semantics"
```

### Task 4: Sidebar context-menu keyboard behavior

**Files:**
- Modify: `src/components/layout/Sidebar.test.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Step 1: Write the failing tests**

Open server and group menus from their triggers. Assert `aria-haspopup`, accurate `aria-expanded`, initial focus on the first menu item, Arrow/Home/End navigation, Escape closure, and focus restoration.

**Step 2: Run test to verify failure**

Run: `pnpm vitest run src/components/layout/Sidebar.test.tsx`

Expected: FAIL because focus is not transferred or navigated and trigger state is not exposed.

**Step 3: Implement centralized menu focus management**

Track the opening element in a ref, focus the first item after render, handle menu navigation on the menu container, and restore focus on Escape or menu action. Keep outside-click closure and drag-and-drop behavior intact.

**Step 4: Run test to verify success**

Run: `pnpm vitest run src/components/layout/Sidebar.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/layout/Sidebar.test.tsx src/components/layout/Sidebar.tsx
git commit -m "fix: support keyboard sidebar context menus"
```

### Task 5: Full regression and visual verification

**Files:**
- Verify: all modified files

**Step 1: Run the focused regression suite**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx src/features/servers/WizardStepIndicator.test.tsx src/components/layout/Sidebar.test.tsx src/styles.test.mjs`

Expected: PASS.

**Step 2: Run static and production checks**

Run: `pnpm tsc && pnpm build`

Expected: both commands exit 0.

**Step 3: Run Electron checks**

Run: `pnpm test:electron-smoke && pnpm test:electron-ui-smoke`

Expected: all smoke assertions pass, including pointer focus suppression and keyboard focus visibility.

**Step 4: Inspect the app in the browser/Electron surface**

Verify Java panel boundaries, Chinese and English text, both themes, wizard header at supported widths, named view controls, and keyboard context menus. Confirm no horizontal overflow or clipped controls.

**Step 5: Review the diff**

Check requirement completeness, correctness, side effects, performance impact, security, and maintainability. Confirm performance polling/log work remains deferred and no server behavior changed.

