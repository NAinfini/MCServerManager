# Architecture

MC Server Manager is a local-first Electron application. Keep the architecture
small: React features call typed feature APIs, the desktop bridge transports
commands, and backend command handlers own SQLite, files, processes, and
network integrations.

## Dependency direction

```text
App and layout composition
  -> feature views
    -> feature API and query keys
      -> desktop runtime

feature views
  -> shared, business-neutral UI
  -> neutral domain types

Electron main
  -> backend command registry
    -> domain handlers
      -> backend context and platform dependencies
```

Feature modules must not import another feature's page component. Cross-feature
composition belongs in `App`, layout components, or an explicit composition
component such as `ServerDetail`.

## State ownership

- SQLite, server files, process state, and remote provider data are authoritative
  in the backend.
- TanStack Query owns renderer copies of backend data.
- Zustand owns persistent UI state only.
- Component state owns transient form, selection, and dialog state.
- Backend data must not be copied into Zustand.

Feature query keys live beside the feature API. Reuse the exported key factory
whenever a query is read, seeded, or invalidated.

## Desktop commands

Backend commands are registered in one explicit command registry. A command
exists independently of the value it returns, so a supported command may
legitimately return `undefined`.

The preload allowlist is the public renderer contract. Backend-only diagnostic
commands stay out of that allowlist. The command contract test must pass when a
command is added, removed, or moved to the Electron main process.

Business views call their feature API instead of invoking arbitrary command
strings. Window, folder-picker, and external-link operations may use the desktop
runtime from app or layout adapters.

## Backend context

Each backend instance owns one concrete context:

- SQLite connection
- application data directory
- injected process, metric, runtime, and port-check dependencies
- per-instance runtime state

New backend domains should receive this context or a narrow slice of it. Do not
add new module-level service maps, repository interfaces, dependency injection
containers, or speculative factories.

## Database schema during development

The application is still in development. The current database definition is
the core schema in `electron/backend.cjs`.

- Do not generate migration files yet.
- Make schema changes directly in the core schema.
- Keep `PRAGMA user_version` aligned with the core schema when compatibility
  code requires it.
- Introduce a migration directory only when a released database must be
  upgraded without recreation.

## Shared UI

Put stable, business-neutral controls in `src/components/ui`. Feature-specific
components stay with the feature until at least two real consumers require the
same behavior.

Use `DialogSurface` for standard modal structure. Specialized dialogs may keep
their own composition when focus, animation, or review workflows differ.

Do not create universal components controlled by mode flags. Share provider
models, adapters, query keys, and leaf components while keeping distinct
install and server-creation flows.
