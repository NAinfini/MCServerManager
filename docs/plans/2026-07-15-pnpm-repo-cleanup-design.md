# pnpm Repository Cleanup Design

## Goal

Reduce the repository's disk usage while preserving source files, reachable Git
history, the pnpm lockfile, and reproducible Electron builds.

## Current State

- `.git` uses about 5.67 GiB, including about 5.66 GiB of unreachable loose
  objects. Reachable packed history is about 7 MiB.
- `.pnpm-store` uses about 2.03 GiB and contains both v3 and v10 stores.
- `node_modules` uses about 1.49 GiB and contains stale `.ignored*` package
  copies.
- `.npmrc` stores pnpm's content-addressed store inside the repository and
  forces package copies, causing the store and installed dependencies to occupy
  separate space under the OneDrive workspace.

## Design

1. Verify that the worktree is clean and that reachable Git objects are valid.
2. Reconfigure pnpm to keep only the hoisted node linker in project settings.
   Use pnpm's normal external store and automatic import method instead of a
   repository-local store with forced copies.
3. Pin the project to one pnpm version through `packageManager` and align the
   documented prerequisite with it.
4. Remove ignored generated directories: `node_modules`, `.pnpm-store`,
   `dist`, `release`, `artifacts`, and `tmp`.
5. Prune unreachable Git objects only after confirming no Git operation is in
   progress.
6. Reinstall dependencies from `pnpm-lock.yaml` with a frozen lockfile.
7. Run the test suite, production build, Electron security tests, and a final
   Git integrity check.

## Error Handling

- Stop immediately if the worktree contains unexpected tracked changes.
- Do not prune Git objects while another Git process or lock file exists.
- Surface dependency installation, test, build, and integrity failures; do not
  report cleanup success if verification fails.
- Keep `pnpm-lock.yaml` unchanged unless the selected pnpm version requires an
  intentional lockfile update.

## Expected Result

The one-time cleanup should reclaim roughly 7–8 GiB. Future installs should no
longer place the pnpm store inside the OneDrive repository or force a second
copied dependency tree. The project remains pnpm-only and build behavior stays
unchanged.

