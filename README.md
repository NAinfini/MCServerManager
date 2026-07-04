# MC Server Manager

[简体中文](README.zh-CN.md)

MC Server Manager is a standalone Electron desktop application for managing local Minecraft server profiles. It is built with Electron, React, TypeScript, Node.js, and SQLite.

## Project Status

This project is an MVP. It focuses on local desktop server management, explicit safety checks, and visible failure states. Remote public administration, RCON, and silent automatic content installation are intentionally out of scope for the first version.

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

If Windows blocks Electron packaging inside a OneDrive-synced workspace with an `EPERM` rename error, build to a local temp directory instead:

```powershell
$out = Join-Path $env:TEMP 'mcsm-release'
pnpm exec electron-builder --win --publish never --config.directories.output=$out
```

## Privacy

MC Server Manager does not include telemetry. The app stores its local database and server metadata on the user's machine.

## Marketplace Limitations

Marketplace integrations are best-effort helpers, not a full package manager. Modrinth and Hangar search use public APIs. CurseForge uses the official API and requires a valid API key for official downloads. BBSMC search and direct-file installs are supported where public metadata exposes stable direct files; versions that only expose cloud-disk links must be downloaded in a browser and imported manually.

The app does not silently auto-install mods, plugins, modpacks, or server jars. Installed content updates are detected on demand; users must click update all or update an individual item before files are downloaded and replaced.

## Application Updates

Packaged builds can check GitHub Releases for app updates. Update downloads are manual, gated behind confirmation, and blocked while managed servers are running.

## Backups

Backups are world-only by default. Backup profiles can broaden scope only when the user explicitly selects a non-default profile.

## First-Version Limits

- No RCON.
- No public remote management interface.
- No telemetry.
- No silent automatic content installation.
- No automatic missed-task replay after downtime.
- Diagnostics report findings and do not mutate settings automatically.
