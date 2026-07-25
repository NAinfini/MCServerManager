# MC Server Manager

[简体中文](README.zh-CN.md)

MC Server Manager is a standalone Electron desktop application for managing local Minecraft server profiles. It is built with Electron, React, TypeScript, Node.js, and SQLite.

## Project Status

This project is in active pre-release development. The local desktop management workflows are implemented end to end, with explicit safety checks and visible failure states. Remote public administration, RCON, and silent automatic content installation remain intentionally out of scope.

## Interface Architecture

- The dashboard aggregates all local servers, lifecycle state, backups, and items that need attention.
- Each server opens a deep-linkable eight-section workbench: Overview, Console, Players, Content, Files & backups, Operations, Automation, and Server settings.
- Console output, lifecycle changes, player state, and performance samples use a shared desktop event channel; only the dashboard summary and active-server status retain bounded fallback polling.
- Marketplace browsing is shared by server creation and installed-content management.
- Structured Minecraft files use table or form editors where possible, while advanced source editing remains available for unsupported formats.
- English and Simplified Chinese are supported across the complete interface.

## Prerequisites

- Node.js 24
- pnpm 11
- Electron build prerequisites for your operating system
- Java can be reused from the local machine or installed as a managed Eclipse Temurin runtime by the app after explicit consent.

## First Server Setup

MC Server Manager provides one trusted provisioning flow for a local file, drag-and-drop, an existing folder, a blank server, or discovery through Modrinth:

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
- macOS: `.dmg` and `.zip` packages.

### Releases are unsigned

This project holds no code-signing certificate for either platform, so every artifact ships unsigned. What that costs you:

- **Windows**: SmartScreen shows an "unrecognized app" warning the first time the installer runs. Choose **More info → Run anyway**.
- **macOS**: Gatekeeper refuses to open the app on a double-click. Right-click the app and choose **Open**, then confirm once.
- **macOS auto-update does not work.** `electron-updater` requires a valid signature to install an update on macOS, so mac users must download each new release manually. The in-app update check still tells you when one exists. Windows and Linux auto-update normally.

To start signing, add the certificate secrets to the repository and set `CSC_LINK` and `CSC_KEY_PASSWORD` on the matching publish step in `.github/workflows/release.yml`, and set `build.mac.identity` in `package.json`.

## Privacy

MC Server Manager does not include telemetry. The app stores its local database and server metadata on the user's machine.

## Marketplace Limitations

Marketplace integrations are best-effort helpers, not a universal package manager. Modrinth provides in-app modpack discovery. CurseForge server packs must be downloaded separately and imported manually until official API credentials are intentionally configured. Hangar and BBSMC remain available for compatible content where their public metadata exposes stable direct files. Versions that expose only cloud-disk links must be downloaded in a browser and imported manually.

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

## Trademark Notice

MC Server Manager is not affiliated with, endorsed by, or associated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Studios. This project is an independent, unofficial tool for managing Minecraft servers you already own.
