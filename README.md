# MC Server Manager

MC Server Manager is a standalone Electron desktop application for managing local Minecraft server profiles. It is built with Electron, React, TypeScript, Node.js, and SQLite.

## Project Status

This project is an MVP. It focuses on local desktop server management, explicit safety checks, and visible failure states. Remote public administration, RCON, and automatic content updates are intentionally out of scope for the first version.

## Prerequisites

- Node.js 22
- pnpm 9
- Electron build prerequisites for your operating system
- Java runtimes installed locally for the Minecraft versions you plan to run

## Development Commands

```powershell
pnpm install
pnpm dev              # renderer dev server only
pnpm electron:dev     # desktop app
pnpm vitest run
pnpm build
pnpm electron:build
```

## Privacy

MC Server Manager does not include telemetry. The app stores its local database and server metadata on the user's machine.

## Marketplace Limitations

Marketplace integrations are best-effort helpers, not a full package manager. Modrinth and Hangar search use public APIs. CurseForge support is manual import only and does not resolve dependencies. BBSMC installation is intentionally disabled until a stable public download contract exists.

The app does not silently auto-install mods, plugins, modpacks, or server jars.

## Backups

Backups are world-only by default. Backup profiles can broaden scope only when the user explicitly selects a non-default profile.

## First-Version Limits

- No RCON.
- No public remote management interface.
- No telemetry.
- No automatic missed-task replay after downtime.
- Diagnostics report findings and do not mutate settings automatically.
