# MC Server Manager

[简体中文](README.zh-CN.md)

MC Server Manager is a standalone Electron desktop application for managing local Minecraft server profiles. It is built with Electron, React, TypeScript, Node.js, and SQLite.

## Project Status

This project is an MVP. It focuses on local desktop server management, explicit safety checks, and visible failure states. Remote public administration, RCON, and silent automatic content installation are intentionally out of scope for the first version.

## Prerequisites

- Node.js 22
- pnpm 9
- Electron build prerequisites for your operating system
- Java can be reused from the local machine or installed as a managed Eclipse Temurin runtime by the app after explicit consent.

## First Server Setup

MC Server Manager provides one trusted provisioning flow for a local file, drag-and-drop, an existing folder, a blank server, or discovery through Modrinth and CurseForge:

1. Select or drop one server pack, browse a marketplace server pack, import a folder, or choose a blank server.
2. Review detected Minecraft and loader metadata. The supported runtime adapters are Vanilla, Paper, Forge, NeoForge, Fabric, and Quilt.
3. Dedicated server packs are preferred. An unverified or client-oriented archive remains selectable only after a visible server-pack warning and explicit acknowledgement; missing versions must be entered by the user.
4. Reuse a compatible Java runtime, or explicitly allow installation of a managed Eclipse Temurin runtime. The managed install does not change the system `PATH`.
5. Configure memory, port, gameplay properties, restart policy, and whether the completed server should start automatically.
6. Read the Minecraft terms and provide explicit EULA confirmation. The EULA checkbox starts unchecked for every new plan and the app never accepts it on the user's behalf.
7. The app downloads only adapter-approved server artifacts, validates available hashes, removes pack-provided scripts, writes configuration, commits files atomically, creates the profile, and starts it when requested.

Interrupted installations are persisted. On the next launch, the app offers to resume an unfinished job or clean up its uncommitted staging files.

## Development Commands

```powershell
pnpm install
pnpm dev              # full desktop app (Vite renderer + Electron local backend)
pnpm dev:renderer     # renderer dev server only
pnpm electron:dev     # compatibility alias for pnpm dev
pnpm vitest run
pnpm build
pnpm electron:build
```

If Windows blocks Electron packaging inside a OneDrive-synced workspace with an `EPERM` rename error, build to a local temp directory instead:

```powershell
$out = Join-Path $env:TEMP 'mcsm-release'
pnpm exec electron-builder --win --publish never --config.directories.output=$out
```

## Release Builds

GitHub Actions publishes platform-specific Electron artifacts from tagged releases:

- Windows: NSIS installer, plus `latest.yml` update metadata.
- Linux: AppImage and `.deb` packages.
- macOS: `.dmg` and `.zip` packages. Current CI builds are unsigned unless signing credentials are added.

## Privacy

MC Server Manager does not include telemetry. The app stores its local database and server metadata on the user's machine.

## Marketplace Limitations

Marketplace integrations are best-effort helpers, not a universal package manager. Modrinth and CurseForge provide in-app modpack discovery; CurseForge official downloads require a valid API key. Hangar and BBSMC remain available for compatible content where their public metadata exposes stable direct files. Versions that expose only cloud-disk links must be downloaded in a browser and imported manually.

Starting the provisioning flow is always a user action. Compatibility warnings, managed Java installation, EULA acceptance, and installed-content updates each require their own visible confirmation or action.

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
