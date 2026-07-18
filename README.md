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

## First Server Setup

MC Server Manager guides the setup, but it does not choose downloads or accept legal agreements for the user. Each server Settings tab includes a setup checklist that detects Java compatibility, `server.jar`, Minecraft EULA acceptance, and whether a backup exists. To start a new server profile:

1. Create or import a server profile.
2. Open Java Runtimes and install the Java version required by the selected Minecraft version if it is not detected.
3. Download the correct server jar from a trusted source such as Mojang, Paper, Fabric, Forge, NeoForge, or another loader project.
4. Open the server Settings tab, then Server updates, and install that downloaded file as `server.jar`.
5. Read the Minecraft EULA. If you accept it, edit `eula.txt` in the server folder and set `eula=true`.
6. Return to the setup checklist and refresh it until Java, `server.jar`, and EULA are marked ready.
7. Start the server and read any console error shown by the app.
8. Create a backup before changing jars, mods, configs, or worlds.

Marketplace installs content such as mods, plugins, or modpacks. It does not remove the need for Java, `server.jar`, and EULA acceptance.

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
