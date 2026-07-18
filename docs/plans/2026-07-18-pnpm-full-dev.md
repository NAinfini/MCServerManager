# Full Application Development Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `pnpm dev` start the Vite renderer and Electron local backend together while retaining renderer-only and legacy development commands.

**Architecture:** Rename the renderer-only script to `dev:renderer`, move the existing concurrent desktop workflow to `dev`, and retain `electron:dev` as an alias. Keep the current port, readiness gate, and shared process lifecycle unchanged.

**Tech Stack:** pnpm 9, Vite 7, Electron 39, concurrently, wait-on, Vitest.

---

### Task 1: Define and implement the development-script contract

**Files:**
- Modify: `docs.test.mjs`
- Modify: `package.json`

**Step 1: Write the failing test**

Add a test that parses `package.json` and requires this exact script topology:

```js
it("starts the complete Electron application through pnpm dev", () => {
  const { scripts } = JSON.parse(read("package.json"));

  expect(scripts["dev:renderer"]).toBe("vite");
  expect(scripts.dev).toBe(
    'concurrently -k "pnpm dev:renderer" "wait-on http://localhost:1420 && electron ."',
  );
  expect(scripts["electron:dev"]).toBe("pnpm dev");
});
```

**Step 2: Verify red**

Run: `pnpm exec vitest run docs.test.mjs`

Expected: FAIL because `dev:renderer` is missing and `dev` still equals `vite`.

**Step 3: Implement the minimal script change**

Update only the three development scripts in `package.json`:

```json
"dev": "concurrently -k \"pnpm dev:renderer\" \"wait-on http://localhost:1420 && electron .\"",
"dev:renderer": "vite",
"electron:dev": "pnpm dev"
```

**Step 4: Verify green**

Run: `pnpm exec vitest run docs.test.mjs`

Expected: PASS.

### Task 2: Update both development-command guides

**Files:**
- Modify: `docs.test.mjs`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing documentation test**

Require both README files to mention `pnpm dev:renderer` alongside `pnpm dev` and `pnpm electron:dev`.

**Step 2: Verify red**

Run: `pnpm exec vitest run docs.test.mjs`

Expected: FAIL because neither README currently documents `pnpm dev:renderer`.

**Step 3: Update the command descriptions**

- Document `pnpm dev` as the complete desktop application.
- Document `pnpm dev:renderer` as renderer-only development.
- Mark `pnpm electron:dev` as a compatibility alias.
- Preserve English/Chinese parity.

**Step 4: Verify green**

Run: `pnpm exec vitest run docs.test.mjs`

Expected: PASS.

### Task 3: Verify integration and review the change

**Files:**
- Review: `package.json`
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `docs.test.mjs`

**Step 1: Run focused tests**

Run: `pnpm exec vitest run docs.test.mjs`

Expected: all documentation and script-contract tests pass.

**Step 2: Run the production build**

Run: `pnpm build`

Expected: TypeScript and Vite complete with exit code 0.

**Step 3: Smoke-test the development command**

Run `pnpm dev` in a bounded process and inspect its output.

Expected: Vite reports `http://localhost:1420`, Electron starts after readiness, and there is no recursive pnpm invocation or immediate process failure.

**Step 4: Perform the mandatory review**

Confirm requirement completeness, correctness, side effects, performance, security, and maintainability. Inspect `git diff --check` and verify that unrelated working-tree changes remain untouched.

