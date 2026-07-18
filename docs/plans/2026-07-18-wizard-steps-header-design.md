# Create Server Wizard Header Steps Design

## Goal

Place the six provisioning steps in the create-server dialog header on the same row as the title and close action. Remove the separate progress row so the wizard body gains vertical space without changing provisioning behavior.

## Layout

The visible header uses three columns:

1. Title and description on the left.
2. The six-step progress indicator in the flexible center column.
3. The close action on the right.

The progress indicator keeps the current, completed, and pending states. At narrower supported window widths, its item padding and connector lengths contract while labels remain visible. The dialog already enforces a 960 px application minimum width, so the header does not need a stacked fallback.

## Component Boundaries

`CreateServerWizard` remains the owner of the current step and provisioning state. It reports a memoized progress model to `AppShell` through a narrow callback. `AppShell` renders `WizardStepIndicator` inside the existing Radix dialog header. The wizard no longer renders a second indicator above its content.

This avoids lifting the full wizard state into the shell and keeps the progress indicator semantically inside the header instead of positioning it with CSS.

When the marketplace detail view intentionally hides the normal dialog header, the existing hidden-title and close behavior remains unchanged.

## Accessibility

- Keep the progress indicator as a labelled `nav` element.
- Preserve `aria-current="step"` on the active step.
- Preserve completed-step navigation behavior if enabled later.
- Keep the dialog title, description, and close label unchanged.
- Do not remove keyboard focus visibility.

## Testing

- Add a component test proving the progress navigation is inside the visible dialog header and not inside the wizard panel.
- Add a progress callback test proving the header receives step changes.
- Add a CSS contract test for the three-column header and compact header-specific step spacing.
- Run the full test suite and production build.
- Verify the create-server dialog in a real browser at standard and minimum supported widths.
