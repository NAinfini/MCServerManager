# Create Server Wizard Header Steps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render the six create-server provisioning steps in the dialog header on the same row as the title and close button.

**Architecture:** `CreateServerWizard` keeps ownership of its step state and publishes a small progress model through a callback. `AppShell` stores that model and renders the existing `WizardStepIndicator` inside a wizard-specific header grid. Scoped CSS compacts the indicator without changing other dialogs that reuse the base header class.

**Tech Stack:** React 19, TypeScript, Radix Dialog, Vitest, Testing Library, CSS.

---

### Task 1: Publish wizard progress without moving wizard state

**Files:**
- Modify: `src/features/servers/CreateServerWizard.tsx:30-145`
- Test: `src/features/servers/CreateServerWizard.test.tsx`

**Step 1: Write the failing test**

Add a test that renders `CreateServerWizard` with `onProgressChange`, waits for the initial callback, and asserts that it receives six labelled steps with `currentStep: 0`. Assert that `.create-server-panel` no longer contains the progress navigation.

```tsx
const onProgressChange = vi.fn();
renderWizard({ onProgressChange });

await waitFor(() => {
  expect(onProgressChange).toHaveBeenCalledWith(
    expect.objectContaining({ currentStep: 0, steps: expect.any(Array) }),
  );
});
expect(onProgressChange.mock.lastCall?.[0].steps).toHaveLength(6);
expect(document.querySelector(".create-server-panel .wizard-steps")).toBeNull();
```

**Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/features/servers/CreateServerWizard.test.tsx --testTimeout 15000`

Expected: FAIL because `onProgressChange` is not a supported prop and the panel still renders `.wizard-steps`.

**Step 3: Implement the minimal progress contract**

Export a progress model and add the callback prop:

```tsx
export interface CreateServerWizardProgress {
  steps: Array<{ label: string; description?: string }>;
  currentStep: number;
}

interface CreateServerWizardProps {
  onProgressChange?: (progress: CreateServerWizardProgress | null) => void;
  // existing props
}
```

Publish the memoized `steps` and current `step` in an effect, clear it on unmount, and remove the inline `WizardStepIndicator` render. Remove the now-unused indicator import.

```tsx
useEffect(() => {
  onProgressChange?.({ steps, currentStep: step });
  return () => onProgressChange?.(null);
}, [onProgressChange, step, steps]);
```

**Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/features/servers/CreateServerWizard.test.tsx --testTimeout 15000`

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/features/servers/CreateServerWizard.tsx src/features/servers/CreateServerWizard.test.tsx
git commit -m "refactor: publish create wizard progress"
```

### Task 2: Render progress inside the dialog header

**Files:**
- Modify: `src/components/layout/AppShell.tsx:1-90,340-415`
- Test: `src/components/layout/AppShell.test.tsx`

**Step 1: Write the failing integration test**

Open the create-server dialog and assert that the progress navigation is a descendant of `.create-server-wizard-header`, alongside the title and close button.

```tsx
const dialog = await screen.findByRole("dialog", { name: "Create server" });
const header = dialog.querySelector(".create-server-wizard-header");
const progress = within(dialog).getByRole("navigation", {
  name: /setup progress/i,
});

expect(header).not.toBeNull();
expect(header).toContainElement(progress);
expect(dialog.querySelector(".create-server-panel .wizard-steps")).toBeNull();
```

**Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/layout/AppShell.test.tsx --testTimeout 15000`

Expected: FAIL because the header does not yet render wizard progress.

**Step 3: Implement the header integration**

Import `WizardStepIndicator` and `CreateServerWizardProgress`. Add nullable progress state and a stable callback. Clear progress when the dialog closes.

Add the scoped class and center column:

```tsx
<div className="create-server-dialog-header create-server-wizard-header">
  <div className="create-server-dialog-title-row">...</div>
  {createServerProgress ? (
    <WizardStepIndicator
      steps={createServerProgress.steps}
      currentStep={createServerProgress.currentStep}
    />
  ) : null}
  <Dialog.Close asChild>...</Dialog.Close>
</div>
```

Pass `onProgressChange={setCreateServerProgress}` to `CreateServerWizard`. Do not render the visible header when the existing marketplace detail state hides it.

**Step 4: Run the integration test to verify it passes**

Run: `pnpm vitest run src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx --testTimeout 15000`

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/components/layout/AppShell.tsx src/components/layout/AppShell.test.tsx
git commit -m "feat: place wizard steps in dialog header"
```

### Task 3: Compact the header-specific progress layout

**Files:**
- Modify: `src/styles.css:3043-3076,3214-3304,3480-3500`
- Test: `src/styles.test.mjs`

**Step 1: Write the failing CSS contract test**

Add a test that extracts `.create-server-wizard-header` declarations and asserts a three-column grid. Also assert that header-scoped `.wizard-steps` removes its separate border and padding.

```js
expect(css).toMatch(
  /\.create-server-wizard-header\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s,
);
expect(css).toMatch(
  /\.create-server-wizard-header\s+\.wizard-steps\s*\{[^}]*padding:\s*0[^}]*border:\s*0/s,
);
```

**Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/styles.test.mjs --testTimeout 15000`

Expected: FAIL because the wizard-specific header rules do not exist.

**Step 3: Implement scoped layout rules**

Keep `.create-server-dialog-header` unchanged for other dialogs. Add:

```css
.create-server-wizard-header {
  display: grid;
  grid-template-columns: minmax(170px, 220px) minmax(0, 1fr) auto;
  gap: var(--space-4);
}

.create-server-wizard-header .wizard-steps {
  min-width: 0;
  padding: 0;
  border: 0;
}

.create-server-wizard-header .wizard-step-item {
  padding: 2px 4px;
}

.create-server-wizard-header .wizard-step-connector {
  width: clamp(18px, 3vw, 36px);
  margin-inline: 4px;
}
```

Scope any circle or label size changes to `.create-server-wizard-header`. Add one narrow-width media rule only if real-browser measurement at 960 px shows overflow.

**Step 4: Run style and component tests**

Run: `pnpm vitest run src/styles.test.mjs src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx --testTimeout 15000`

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/styles.css src/styles.test.mjs
git commit -m "style: compact wizard steps in header"
```

### Task 4: Verify the complete application

**Files:**
- Review only: all files changed above

**Step 1: Run the full test suite**

Run: `pnpm vitest run --testTimeout 15000`

Expected: all tests pass.

**Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete successfully.

**Step 3: Run the Electron UI smoke test**

Run: `npm run test:electron-ui-smoke`

Expected: preload bridge, six-step wizard, console capture, and focus checks pass.

**Step 4: Verify real layout geometry**

Use the local browser test harness at 1280×900 and 960×720. Assert that the header, title row, progress navigation, and close button do not overlap and that the progress navigation is contained by the header. Capture one screenshot for visual review.

**Step 5: Review and commit any verification-only test update**

Run `git diff --check` and confirm no unrelated files changed. If the Electron smoke test gains a header containment assertion, commit it separately:

```powershell
git add electron/ui-smoke.cjs
git commit -m "test: verify wizard steps stay in header"
```
