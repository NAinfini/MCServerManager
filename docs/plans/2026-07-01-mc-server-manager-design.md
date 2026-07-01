# MC Server Manager Product Design

## Goal

Build a standalone cross-platform Minecraft server management suite for home servers. The app should let users create, run, recover, back up, and extend multiple Minecraft servers from one polished desktop interface.

## Confirmed Decisions

- Product form: standalone desktop app, not a web app.
- Target platforms: Windows and Linux with equal priority.
- Remote management: not in scope.
- Core stack: Tauri v2, React, TypeScript, Rust, SQLite.
- Frontend stack: Radix Primitives, Tailwind CSS, CVA, clsx, tailwind-merge, Lucide React, Motion, TanStack Query, Zustand, React Hook Form, Zod, TanStack Table, TanStack Virtual, Monaco Editor, xterm.js.
- Server scope: multiple Minecraft server profiles, which may or may not run at the same time.
- Resource control: basic limits only: memory, ports, auto-start, restart policy.
- Content scope: mods, plugins, and modpacks.
- Marketplace scope: per-server marketplace for Modrinth, CurseForge manual import, Hangar, BBSMC, local import, and later mainstream providers.
- BBSMC scope: only free public resources that do not require login.
- Conflict policy: warn users and allow them to continue.
- App close behavior: ask whether to minimize to tray or close.
- Background runtime: continue running through the desktop app's system tray mode, not a machine-wide service.
- Updates: support update checks and in-place updates, but do not install updates while any managed server is running.
- Project model: open source.
- License: MIT.
- Update channel: stable only.
- App data: store application state in the per-user application data directory.
- File editing: only allow editing text files inside the selected server directory.
- Localization: Chinese and English first, with room for more languages later.
- Theme support: light, dark, and system.
- Player management: add a per-server Players tab for viewing players and sending op, deop, ban, unban, and kick commands through managed stdin.
- Telemetry: none by default.

## Product Positioning

This app targets users running Minecraft servers on a local PC, bedroom server, or home lab box. The main problems are server crashes, manual restarts, missing backups, tunnel agents stopping, Java version confusion, loader setup, and mod/plugin management.

Existing tools cover parts of this:

- Crafty Controller covers web-based Minecraft server management, backups, files, commands, and players.
- MC Server Soft covers Windows desktop server management with scheduling and backups.
- Pterodactyl focuses on hosted multi-user Docker-based game server infrastructure.
- MCSManager focuses on distributed web plus daemon management.
- PufferPanel focuses on general game panel management.

This app should be lighter than Pterodactyl, more desktop-native than Crafty, more cross-platform than MC Server Soft, and more focused on home-server recovery workflows than generic game panels.

## Architecture

```text
Tauri Desktop App
  React UI
  Rust Core
  Tray Background Runtime
  Profile Manager
  Process Supervisor
  Java Manager
  Loader Manager
  Backup Manager
  Content Manager
  Tunnel Manager
  Event Log
  SQLite
  Local filesystem
  Minecraft server processes
  Tunnel provider processes or agents
```

The Rust core is the authority for filesystem access, process lifecycle, backups, downloads, and validation. The React UI invokes typed Tauri commands and renders app state from query/event streams.

The desktop window and tray background runtime are separate concerns inside the same desktop app. The tray runtime keeps server supervision, crash recovery, tunnel monitoring, and scheduled backups alive after the window is closed. Closing the window should prompt the user to minimize to tray or fully quit.

The app should not install a machine-wide service in the first version. App state lives in the per-user application data directory, such as `%APPDATA%/MCServerManager` on Windows and the XDG data directory on Linux. Optional launch-at-login can start the tray runtime for the current user session, but servers cannot recover before that user session starts. If the user fully quits the tray runtime while servers are running, the app must warn that supervision, auto-restart, scheduled backups, and tunnel monitoring will stop.

Updates may be checked at any time, but in-place update installation is blocked while any managed server is running. The app should ask the user to stop all servers before applying an update.

## Main Modules

### Server Profiles

Each server profile stores:

- Name
- Working directory
- Minecraft version
- Loader type
- Loader version
- Java runtime path
- Launch command
- Stop command
- Server port
- Memory settings
- Auto-start setting
- Restart policy
- Scheduled tasks
- Linked tunnel providers
- Backup policies
- Installed content index
- Content update policy

Server creation entry points:

- Create a blank server from loader/version.
- Import an existing server folder.
- Create from a marketplace modpack.
- Create from a local modpack file such as `.mrpack`, CurseForge manifest zip, or generic server pack zip.

The create server wizard should treat marketplace modpacks as first-class options instead of requiring users to create an empty server first.

Supported loaders for the first full version:

- Vanilla
- Paper
- Forge
- NeoForge
- Fabric

Later candidates:

- Quilt
- Purpur
- Spigot
- Bukkit
- Velocity
- Waterfall
- Bedrock Dedicated Server

### Process Supervisor

The supervisor manages server lifecycle:

- Start
- Stop
- Restart
- Graceful stop command
- Shutdown timeout
- Crash detection
- Auto-restart
- Restart cooldown
- Max restart attempts
- Auto-start after app launch
- Recovery after Windows or Linux restart
- Reattach to previously managed server processes when possible
- Track child process metadata for app-launched Java servers

The supervisor must distinguish user-requested stops from crashes. It should not hide errors or fake successful starts.

Servers are launched through app-managed Java commands owned by the tray runtime. This gives the app process ownership, stdout/stderr capture, and the ability to gather details from logs and server query/status polling. If the app restarts after a crash, it should attempt to identify and reattach to previously managed Java processes. If confidence is low, the UI should mark the process as externally running and require user confirmation before taking destructive action.

### Scheduled Tasks

Each server can define scheduled tasks owned by the tray runtime.

Supported first-version task types:

- Start server
- Stop server
- Restart server
- Backup world
- Run safe server command through managed stdin
- Check server updates
- Check mod/plugin updates

Rules:

- Tasks are per server, not global automation scripts.
- Tasks do not run if the tray runtime is fully closed.
- Tasks that send commands require the server to be running and managed by the app.
- Missed tasks after app downtime are shown as missed instead of silently replayed.
- Task failures create visible events and optional desktop notifications.

### Console And Logs

The app provides:

- Live stdout/stderr console
- Command input
- Log retention
- Crash summaries
- Search/filter
- Copy/export logs
- Startup failure diagnosis
- Online player/status display when available through server query, log parsing, or compatible server APIs
- No RCON integration in the first version

xterm.js should power the interactive console view. Logs should also be stored as structured events where possible.

Status detection priority:

```text
1. Managed process state
2. Server query/status ping when enabled and available
3. Log parsing
4. Loader/plugin-specific integrations later
```

RCON is intentionally excluded from the first version.

### Resource Monitoring And History

The app should collect lightweight local metrics for each managed server:

- CPU usage
- Memory usage
- Disk usage for server directory
- Uptime
- Restart count
- Player count when available
- Tunnel status history

The overview shows current values. The Performance tab shows recent history and lets the user inspect spikes around crashes, backups, installs, and restarts. Metrics are sampled locally and stored with retention limits to avoid unbounded database growth.

### Player Management

Each server detail page should include a Players tab.

Features:

- Online players list when available
- Known players list when available
- Operator list
- Ban list
- Player detail panel
- Actions: op, deop, ban, unban, kick, copy UUID

Rules:

- No RCON in the first version.
- Player actions use managed server stdin commands where possible.
- Ban, unban, op, and deop require confirmation.
- Do not show a per-player command editor/commander. The UI should show normal action confirmations and send the correct command internally.
- Actions are disabled when the server is stopped.
- If player data is unavailable, show an explicit unavailable state instead of fake values.

List files such as `ops.json`, `banned-players.json`, `banned-ips.json`, and `whitelist.json` should be presented as structured tables when the format is valid. The raw file editor remains available through the Files tab, but player-list operations should prefer structured UI actions with confirmation.

### Java Manager

The Java manager handles:

- Scanning installed Java runtimes
- Detecting Java major version and architecture
- Matching Minecraft version requirements
- Warning when Java is incompatible
- Offering official download links
- Downloading an app-managed Java runtime after explicit user confirmation

Initial behavior should detect Java and show download options. The app may download Java for the user only after a clear confirmation step.

### Loader Manager

The loader manager handles:

- Server creation from loader/version
- Importing existing server directories
- Downloading server jars or installers
- Generating launch command defaults
- EULA workflow
- Updating server executable where safe

Loader-specific install logic must be isolated behind provider interfaces.

Loader install strategy:

- Vanilla: download the official server jar for the selected Minecraft version.
- Paper: use PaperMC metadata to select builds and download the server jar.
- Fabric: use Fabric installer/profile metadata to generate the server launch layout.
- Forge: run or reproduce the Forge server installer flow in a controlled server directory.
- NeoForge: run or reproduce the NeoForge server installer flow in a controlled server directory.

Each loader provider must return a normalized launch command, expected content directories, supported Minecraft versions, and update behavior. Updating a loader must create a rollback snapshot first.

### Server Update Manager

Server executable updates are managed per server.

Supported first-version update scope:

- Vanilla server jar updates
- Paper build updates
- Fabric installer/profile updates when safe
- Forge and NeoForge update detection with guided install flow

Rules:

- Only stable releases are shown by default.
- Updates are checked locally from provider metadata.
- Installing a server update requires the server to be stopped.
- A rollback snapshot is created before replacing server executable files.
- The UI must show current version, available version, loader channel, changelog link when available, and rollback status.
- The app must not auto-update a running server.

### Backup Manager

Backups are required before risky operations. The default server backup target is the active world directory only.

Features:

- Manual backup
- Scheduled backup
- Startup backup
- Pre-install rollback snapshot
- Backup retention count
- Backup compression
- Exclusion paths
- Default world-only backup scope
- Restore in place
- Restore and reset server directory
- Backup before update

Backup profiles are supported, but the default remains world-only. Built-in profile types:

- World only
- World plus configs
- Full server folder
- Custom include/exclude

Each profile can define schedule, retention, compression, live-backup behavior, and restore target. The UI should keep the default path obvious so a new user does not accidentally create huge full-folder backups.

Live backups are allowed by default, but the UI must clearly warn when backing up a running server can produce inconsistent files. The default live-backup routine should back up only the server's world directory and prefer a safe command sequence when console stdin is available:

```text
save-off
save-all flush
copy the world directory
save-on
```

If any step fails, the app must surface the failure and attempt `save-on` before leaving the backup flow. A safer stop-backup-restart mode should remain available.

Forge, NeoForge, and Fabric do not remove the need for external backup management. Backup mods exist, but they are optional server content, not a replacement for app-managed backups.

Content installs and updates should keep a lightweight change journal for files they add, replace, disable, or remove. This is separate from world backups and lets the app undo a failed mod/plugin operation without turning every content change into a full server backup.

### Content Manager

The content manager handles mods, plugins, and modpacks inside a selected server context.

Providers:

- Modrinth
- CurseForge manual import only until API-key handling is explicitly added
- Hangar
- BBSMC
- Local import
- Later: SpigotMC, FTB, Technic, GitHub Releases, direct URL

Content types:

- Mods
- Plugins
- Modpacks
- Later: datapacks, resource packs, shader packs

Required capabilities:

- Browse marketplace
- Search and filter by Minecraft version, loader, environment, content type, provider
- View project details
- View versions
- Install selected version
- Install required dependencies when available
- Show optional dependencies
- Warn about incompatible dependencies
- Check installed content via file hash and metadata
- Disable content without deleting files
- Uninstall content
- Update check
- Batch update
- Update policy
- Rollback after broken install

Manual URL import should be supported separately from marketplace providers. CurseForge API-key handling is intentionally deferred because it adds user friction. First-version CurseForge support should focus on local/manual imports rather than full marketplace browsing, dependency resolution, or update checks.

Content update policy is configurable per server and per installed item:

- Manual only
- Notify only
- Batch update after confirmation
- Pin current version
- Ignore specific update

The app should never auto-update mods, plugins, or modpacks without explicit confirmation. Severe compatibility warnings block the normal update button and require "install anyway" confirmation.

Provider reliability requirements:

- Cache marketplace responses with short TTLs to reduce rate pressure.
- Store provider source, project id, version id, download URL, file name, hash, and install time.
- Verify downloads with provider hashes when available.
- Retry transient failures with visible errors, not silent fallbacks.
- Let users disable individual providers.
- Keep manual URL imports separate from trusted marketplace installs.
- Never execute commands supplied by marketplace metadata.

### BBSMC Provider

BBSMC is first-class in the UI, but first version scope is limited:

- Free public resources only
- No login
- No paid resources
- No restricted downloads
- No saved cookies or tokens
- No bypassing platform download rules

The provider should support:

- Site browsing inside the app UI
- Search and category browsing
- Resource details
- Version list when available
- One-click install for public files
- Metadata extraction: Minecraft versions, loaders, dependencies, resource type, file name

Risk: no stable public API contract has been confirmed. The provider should be isolated and disable-able. If implementation depends on an internal API or page parsing, it must be treated as high maintenance risk.
Page parsing is acceptable when no documented API is available, but it must be isolated, rate-limited, easy to disable, and respectful of platform restrictions.

BBSMC page parsing rules:

- Use a clear app User-Agent.
- Rate-limit requests.
- Do not parse login-only, paid, or restricted resources.
- Do not store cookies or tokens.
- Prefer public metadata endpoints if they are documented later.
- If parsing breaks, disable BBSMC features gracefully and show a provider error.

### Conflict And Compatibility Checks

The app warns but allows override.

Warnings include:

- Minecraft version mismatch
- Loader mismatch
- Java version mismatch
- Missing required dependency
- Declared incompatible dependency
- Client-only content installed on server
- Server-only content installed in wrong target
- Duplicate mod id
- Duplicate plugin name
- Unknown source
- Missing hash
- Unverified file

Conflict detection levels:

```text
Level 1: Deterministic metadata checks
Level 2: JAR metadata parsing
Level 3: Test boot log analysis
Level 4: Known unresolved risks
```

The app should not claim it can prove all mod conflicts. Runtime conflicts, mixin conflicts, worldgen conflicts, and config conflicts can only be warned about or detected after startup failures.

### Modpack Support

Supported formats:

- Modrinth .mrpack
- CurseForge manifest zip
- Generic server pack zip
- Local directory import
- BBSMC modpacks when public download and format are supported

Modpack install must create a new server profile or explicitly replace an existing profile after a rollback snapshot. Marketplace modpacks should appear in the create-server flow as a first-class option.

### Profile Import And Export

Users can export a server management profile without copying the whole server directory.

Export should include:

- Server metadata
- Loader/runtime settings
- Restart policy
- Scheduled tasks
- Backup profiles
- Tunnel bindings by provider reference
- Installed content index
- Marketplace provider metadata

Export must not include secrets, tunnel tokens, local absolute Java paths unless explicitly requested, logs, backups, or world data by default. Import should validate paths, show missing Java/runtime/provider dependencies, and let the user remap directories before creating the profile.

### Tunnel Manager

Tunnel providers are managed separately from Minecraft servers.

Providers:

- playit
- ngrok
- cloudflared
- custom command

Lifecycle options per server:

- Start tunnel before server
- Start tunnel after server
- Keep tunnel running after server stops
- Stop tunnel when server stops
- Restart tunnel if it exits
- Only monitor an external/global agent

The MVP should support custom command providers and playit agent status detection first.

Tunnel bindings must support shared processes. Multiple servers may depend on the same global tunnel agent or the same user-selected tunnel process. The app should let users select which process or command to start when a server runs, then track process ownership and avoid stopping a shared tunnel while another bound server still needs it.

### Diagnostics And Health Checks

Diagnostics should help users understand why a server failed before they search logs manually.

Checks:

- Java version and architecture
- Missing server jar or loader files
- EULA not accepted
- Port already in use
- Server directory permissions
- Low disk space
- Memory allocation above available RAM
- Recent crash exit code
- Marketplace provider availability
- Tunnel process missing or stopped

Diagnostics are explicit checks with visible pass/warn/fail results. They should not hide startup failures or silently change settings.

### Desktop Notifications

Desktop notifications are local-only and configurable.

Events:

- Server crashed
- Auto-restart failed
- Backup completed or failed
- Scheduled task failed
- Java incompatibility detected
- Server update available
- Mod/plugin update available
- Tunnel stopped unexpectedly

Notifications are off for noisy informational events by default. Critical failures are enabled by default and can be disabled in App Settings.

### UI Direction

The UI should feel like a serious server control surface, not a generic SaaS dashboard.

Expected views:

- Server overview
- Server detail
- Console
- Players
- Files/config editor in the first implementation phase
- Per-server Backups tab
- Per-server Mods/Plugins marketplace tab
- Installed content
- Java runtimes
- Tunnel providers
- Settings
- Localization settings
- Update status

Visual direction: clean professional desktop.

Visual goals:

- Dense but readable
- Strong status language
- Clear risk states
- Excellent log and console presentation
- Fast workflows for repeated server operations
- Polished interactions and motion

Radix should provide accessible primitives. The visual system should be custom.

## Data Model Sketch

```text
servers
server_runtime_settings
server_restart_policies
managed_processes
tray_runtime_state
java_runtimes
loader_installations
backups
backup_policies
content_projects
content_versions
installed_content
marketplace_sources
download_cache
provider_cache_entries
tunnel_providers
tunnel_bindings
process_events
audit_events
app_updates
scheduled_tasks
server_property_overrides
player_list_entries
resource_samples
server_update_history
backup_profiles
notification_settings
profile_exports
diagnostic_runs
content_update_policies
i18n_settings
```

SQLite stores app state, metadata, history, and indexes in the per-user application data directory. Large files, logs, server data, and backups remain on disk.

## MVP Definition

Because the selected scope is a full management suite, the MVP should still ship in vertical slices:

1. App shell, SQLite, basic layout.
2. Tray background runtime foundation.
3. Create/import one server profile.
4. Start, stop, restart, and live console.
5. Crash detection, restart policy, and process reattach.
6. File/config editor limited to text files inside the server directory.
7. Java scan, compatibility warnings, and user-confirmed Java download.
8. Vanilla and Paper support.
9. Backup and restore with live-backup command sequence.
10. Update check and in-place update path, blocked while servers are running.
11. Modrinth install for mods/plugins with warnings.
12. Local JAR import and metadata parsing.
13. Add Forge, NeoForge, Fabric.
14. Add CurseForge and Hangar.
15. Add BBSMC public free resource provider.
16. Add modpack import.
17. Add tunnel provider management with shared process tracking.
18. Add scheduled tasks.
19. Add structured server properties editor.
20. Add structured whitelist, ops, and ban-list management.
21. Add performance/resource history.
22. Add server executable update management.
23. Add backup profiles while keeping world-only default.
24. Add desktop notifications.
25. Add profile import/export.
26. Add diagnostics and health checks.
27. Add mod/plugin update policies.

## Out Of Scope

- Public remote management
- Multi-user accounts
- Role-based access control
- Cloud sync
- Docker/container isolation
- Multi-node management
- Paid BBSMC downloads
- BBSMC login integration
- Full automatic conflict proofing
- Arbitrary remote shell execution
- Telemetry or automatic analytics

## Security And Safety

The app controls local processes and files, so dangerous actions must be explicit.

Risky operations require confirmation:

- Delete server
- Delete world
- Restore backup
- Replace modpack
- Install unknown file
- Continue after severe compatibility warning
- Change Java executable
- Run custom tunnel command
- Edit files outside the server directory

The app must not execute arbitrary commands from marketplace metadata. Custom commands are user-authored only and should be visible/editable.

The file editor must restrict edits to text files inside the configured server directory. Binary files, paths outside the server root, path traversal, and symlink escapes should be blocked. Large files should open read-only or require confirmation. Saving a file should keep a short local edit backup so users can recover from accidental edits.

## Testing Strategy

The implementation plan should include:

- Rust unit tests for profile validation, path safety, backup path selection, restart policy logic, and provider metadata normalization.
- Frontend component tests for critical dialogs, warning flows, forms, and marketplace install confirmations.
- Integration tests with a fake Java server process that emits logs, accepts stdin commands, exits unexpectedly, and simulates crash recovery.
- Backup tests that verify `save-off`, `save-all flush`, copy, and `save-on` ordering when stdin is available.
- File editor tests for text detection, maximum file size behavior, symlink escape blocking, and save backup creation.
- Provider fixture tests for Modrinth, Hangar, BBSMC parsing, and local JAR metadata.
- Scheduled-task tests for missed-run handling, failure events, and command gating when a server is stopped.
- Server update tests for stopped-server requirement, rollback snapshot creation, and stable-channel filtering.
- Backup-profile tests for world-only default, full-folder opt-in, custom include/exclude, and retention.
- Diagnostics tests for Java mismatch, port-in-use, missing jar, EULA, low disk, and tunnel stopped checks.
- Cross-platform smoke tests on Windows and Linux for launch, tray behavior, process cleanup, and update blocking while servers are running.

## Open Questions

No open product-scope questions remain from the initial planning pass.

Resolved decisions:

- Java: detect installed runtimes and show download links first; download Java for the user only after explicit confirmation.
- Backups: allow live backup by default with a clear corruption-risk warning; use `save-off`, `save-all flush`, and `save-on` when console access is available.
- UI theme: clean professional desktop.
- BBSMC: page parsing is acceptable if no documented API is available, provided it is isolated, rate-limited, and disable-able.
- File editing: include the server file/config editor in the first implementation phase.
- Closing the app: ask whether to minimize to tray or close the UI.
- Theme support: light, dark, and system.
- Background supervision: use the desktop app's system tray runtime, not a machine-wide service.
- Updates: support update checks and in-place updates, but block update installation while servers are running.
- Update channel: stable only.
- Process ownership: app-launched Java servers are managed child processes of the tray runtime; after app restart, try to identify and reattach.
- Tunnel lifecycle: users select which process/command opens with a server; shared tunnel processes must be reference-tracked.
- Project model: open source.
- License: MIT.
- App data: store app state in per-user app data directories.
- File editing boundary: only text files inside the server directory.
- Client-only content: warn through conflict checking instead of silently filtering.
- Localization: Chinese and English first, more languages later.
- Telemetry: none.
- CurseForge: no API integration in the first version; avoid API-key friction and support manual/local import first.
- Backup storage: local-only first.
- Backup scope: default to world-only backups.
- RCON: no RCON integration in the first version.
- Player management: add a per-server Players tab with op, deop, ban, unban, and kick actions through managed stdin. Do not expose a per-player command editor.
- Extended management suite: include scheduled tasks, structured `server.properties` editing, whitelist/ops/ban-list management, resource history, server update management, backup profiles, desktop notifications, profile import/export, diagnostics, and mod/plugin update policies.

Remaining questions:

No open product-scope questions remain from this review pass.

## Recommended Next Step

Create an implementation plan that starts with the app foundation and one end-to-end server lifecycle path before adding marketplace complexity. The first build should prove that the app can create/import a server, start it, show logs, stop it, detect crashes, and recover safely.
