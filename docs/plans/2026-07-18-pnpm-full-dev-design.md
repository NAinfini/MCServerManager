# Full Application Development Command Design

**Date:** 2026-07-18

## Objective

Make `pnpm dev` start the complete local Electron application: the Vite renderer and the Electron main process that owns the local backend.

## Current State

- `pnpm dev` starts only Vite on port 1420.
- `pnpm electron:dev` starts Vite, waits for port 1420, and then starts Electron.
- The backend is integrated into the Electron main process through `electron/backend.cjs`; there is no separate HTTP backend service.

## Chosen Design

- Move the renderer-only command to `pnpm dev:renderer`.
- Make `pnpm dev` run the existing concurrent Vite-and-Electron workflow.
- Keep `pnpm electron:dev` as a compatibility alias for `pnpm dev`.
- Keep `wait-on` so Electron does not load the renderer URL before Vite is ready.
- Keep `concurrently -k` so both processes share one development lifecycle.

Only package scripts and the English and Chinese development-command documentation change. Application runtime code and backend behavior remain unchanged.

## Verification

- Add a script contract test before changing `package.json`.
- Run the focused test and confirm it fails for the old script layout.
- Update scripts and documentation, then rerun the focused test.
- Run the production build.
- Start `pnpm dev` and verify that Vite becomes ready and Electron reaches its main process without a script recursion failure.

