# Release Readiness Hardening Design

## Goal

Close the safety, usability, accessibility, and release-validation gaps found in the starter-manager review without broadening the product scope.

## Decisions

- Keep the work surgical. Do not refactor unrelated server-management features.
- Reject backup restore while the server is running or its process state is unsafe.
- Check the configured TCP port immediately before every server start, including provisioning auto-start and scheduled starts.
- Do not store or request a CurseForge API key in this release. Remove official CurseForge discovery from user-facing creation flows and retain clearly labelled manual import support.
- Use `:focus-visible` only. Keyboard navigation receives a visible focus indicator; mouse clicks do not.
- Replace broad transitions and ASCII loading ellipses in affected shared UI paths, and set the native color scheme from the selected application theme.
- Add a production-renderer Electron UI smoke test. Keep the existing deterministic provisioning smoke test.
- Allow unsigned development builds, but make stable-release signing requirements explicit and machine-verifiable. Actual signing remains blocked until platform credentials are supplied.

## Backend Safety

Backup restore checks the authoritative managed-process state before deleting or copying a world directory. A running, starting, stopping, or externally running server produces a visible, non-retryable error and leaves all files unchanged.

Server start becomes an asynchronous preflight operation. It first rejects another active managed profile using the same port, then attempts a short-lived bind on the configured host/port to detect operating-system conflicts. The probe closes before Java starts. Port errors use stable codes and actionable messages. All call sites await the same start path.

## Marketplace Behavior

Modrinth remains the integrated discovery provider. CurseForge creation search is removed while no API key exists. Existing manual CurseForge JAR/pack import remains available and is labelled as manual; backend API support stays dormant for future credential work.

## Accessibility and UI

The global `:focus` reset is removed. A consistent `:focus-visible` rule covers buttons, links, form fields, and custom controls. Pointer focus remains visually quiet because styles do not target plain `:focus`.

The shared theme controller sets `color-scheme` to match light or dark mode. Affected loading strings use the ellipsis character. The wizard transition lists explicit properties instead of `all`.

## Desktop and Release Verification

A smoke harness launches the built Electron application in an isolated temporary user-data directory, waits for the renderer, verifies the preload bridge, opens the Create Server dialog, checks its six-step structure, and exits with a non-zero code on failure. CI builds before running this smoke.

Release workflows distinguish unsigned development artifacts from stable releases. Stable signing checks report exactly which credentials are missing. No credentials or secret values are logged.

## Testing

Each behavior follows red-green-refactor:

1. Backend tests reproduce live-restore and port-conflict failures.
2. UI tests prove CurseForge discovery is absent while manual import remains.
3. CSS/theme contract tests prove keyboard-only focus, explicit transitions, ellipses, and color scheme.
4. Electron smoke verifies the production renderer and preload bridge.
5. Full Vitest, production build, desktop smoke, and `git diff --check` complete the final gate.
