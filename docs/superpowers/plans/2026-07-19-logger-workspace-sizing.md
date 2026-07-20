# Logger Workspace Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the application log workspace fill the remaining page height and allocate approximately 60% of wide-screen width to the log list.

**Architecture:** Keep the existing React markup and implement sizing entirely through the established CSS layout. The logger page becomes a definite-height grid, the workspace consumes its final flexible row, and the existing `1100px` breakpoint restores a vertically stacked, page-scrollable layout.

**Tech Stack:** React 19, CSS Grid, Vitest style-contract tests.

## Global Constraints

- Only modify application logger layout CSS and its style regression tests.
- Do not change typography, button sizing, log grouping, data fetching, or other pages.
- Wide screens use an approximately `60:40` list-to-detail ratio.
- Widths at or below `1100px` use the existing stacked layout.

---

### Task 1: Responsive Logger Workspace Sizing

**Files:**
- Modify: `src/styles.css`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: Existing `.logger-page`, `.app-log-workspace`, `.app-log-list`, `.app-log-detail-pane`, and `@media (max-width: 1100px)` selectors.
- Produces: A definite-height logger workspace with internal list scrolling and responsive stacked fallback.

- [ ] **Step 1: Write the failing style-contract test**

Add a test that extracts the logger selectors and asserts:

```js
expect(page).toMatch(/height:\s*100%/);
expect(page).toMatch(/grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/);
expect(workspace).toMatch(/grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(320px,\s*2fr\)/);
expect(workspace).toMatch(/min-height:\s*0/);
expect(list).toMatch(/height:\s*100%/);
expect(list).toMatch(/max-height:\s*none/);
expect(detail).toMatch(/height:\s*100%/);
expect(narrow).toMatch(/\.logger-page\s*\{[^}]*height:\s*auto/);
expect(narrow).toMatch(/\.app-log-list\s*\{[^}]*height:\s*auto[^}]*max-height:\s*340px/s);
```

- [ ] **Step 2: Run the test and confirm the current fixed-height layout fails**

Run:

```powershell
pnpm vitest run src/styles.test.mjs
```

Expected: the new logger sizing test fails because the list still has `max-height: min(620px, calc(100vh - 270px))` and the workspace uses `0.9fr 1.1fr`.

- [ ] **Step 3: Implement the minimal responsive CSS**

Update the existing rules to establish the approved height chain and ratio:

```css
.logger-page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  gap: var(--space-5);
  overflow: hidden;
}

.app-log-list {
  height: 100%;
  max-height: none;
}

.app-log-workspace {
  grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr);
  height: 100%;
}

.app-log-detail-pane {
  height: 100%;
  min-height: 0;
  overflow: auto;
}
```

Inside `@media (max-width: 1100px)`, restore content-driven sizing:

```css
.logger-page {
  height: auto;
  overflow: visible;
}

.app-log-workspace {
  height: auto;
}

.app-log-list {
  height: auto;
  max-height: 340px;
}

.app-log-detail-pane {
  height: auto;
}
```

- [ ] **Step 4: Run targeted and complete verification**

Run:

```powershell
pnpm vitest run src/styles.test.mjs src/features/logger/AppLoggerView.test.tsx
pnpm vitest run
pnpm build
git diff --check
```

Expected: all tests and the production build pass, with no whitespace errors.

- [ ] **Step 5: Review the change**

Confirm requirement completeness, no horizontal overflow at the `1100px` boundary, no data/security changes, negligible performance impact, and selectors remain scoped to the logger page.
